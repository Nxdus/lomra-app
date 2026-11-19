// Local speech-to-text child process: run by main.mjs with ELECTRON_RUN_AS_NODE. Not loaded by the renderer.
import { env, pipeline } from '@huggingface/transformers';
import { defaultSpeechModel, speechModelInstalled, speechModels } from './speech-models.mjs';
import { createWhisperServer } from './whisper.mjs';

const cacheDir = process.env.LOMRA_WHISPER_CACHE;
env.cacheDir = cacheDir;
// Downloads are cached as <cacheDir>/<repo>/<file>, the same layout as local models, so a cached model
// loads with the network switched off (transformers.js still fetches config.json when only `local_files_only` is set).
env.localModelPath = cacheDir;
env.allowRemoteModels = false;

const find = (id) => speechModels.find((model) => model.id === (id ?? defaultSpeechModel));
let current; // { id, recognizer }: one model stays in memory at a time
let loading; // { id, download, promise }

/** Load a model from the cache; only a user-approved `download` may fetch it from the network. */
function load(model, download) {
  env.allowRemoteModels = download;
  const promise = pipeline('automatic-speech-recognition', model.repo, { dtype: 'q8' })
    .then(async (recognizer) => {
      const previous = current;
      current = { id: model.id, recognizer };
      await previous?.recognizer.dispose?.();
    })
    .catch((cause) => console.error(`whisper model unavailable: ${cause?.message ?? cause}`))
    .finally(() => { env.allowRemoteModels = false; loading = undefined; });
  loading = { id: model.id, download, promise };
}

/**
 * transformers.js cannot detect the spoken language and would assume English, so decode one
 * token after <|startoftranscript|>: for a multilingual Whisper that token is the language.
 */
async function detectLanguage(samples) {
  const { model, processor } = current.recognizer;
  const config = model.generation_config;
  const { input_features } = await processor.feature_extractor(samples.subarray(0, 30 * 16000));
  const output = await model.generate({ inputs: input_features, decoder_input_ids: [config.decoder_start_token_id], max_new_tokens: 1, generation_config: { ...config, return_timestamps: false } });
  const token = Number(output.data.at(-1));
  return Object.entries(config.lang_to_id).find(([, id]) => id === token)?.[0].slice(2, -2) ?? 'en';
}

const server = createWhisperServer({
  async prepare(id) {
    const model = find(id);
    if (!model) return 'unknown';
    if (current?.id === model.id) return 'ready';
    if (loading?.download) return 'loading';
    if (loading) await loading.promise;
    if (current?.id === model.id) return 'ready';
    if (!speechModelInstalled(cacheDir, model)) return 'missing';
    load(model, false);
    await loading.promise;
    return current?.id === model.id ? 'ready' : 'missing';
  },
  download(id) {
    const model = find(id);
    if (model && !loading && current?.id !== model.id) load(model, true);
  },
  info: () => ({ downloading: loading?.download ? loading.id : null }),
  async transcribe(samples, id) {
    if (current?.id !== find(id).id) throw new Error('The speech model changed during the request');
    const language = await detectLanguage(samples);
    const result = await current.recognizer(samples, { language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    return { text: Array.isArray(result) ? result.map((part) => part.text).join(' ') : result.text, language };
  },
});

server.listen(Number(process.env.LOMRA_WHISPER_PORT), '127.0.0.1');
// The parent holds our stdin open; when it exits (even abruptly) the pipe closes and we stop too.
process.stdin.on('close', () => process.exit(0)).resume();
