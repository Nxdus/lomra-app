import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Whisper models for voice input, as quantized ONNX builds. `bytes` is the approximate download size. */
export const speechModels = [
  { id: 'tiny', repo: 'onnx-community/whisper-tiny', name: 'Whisper Tiny', quality: 'Basic', note: 'Smallest. Weak on Thai.', bytes: 46e6 },
  { id: 'base', repo: 'onnx-community/whisper-base', name: 'Whisper Base', quality: 'Good', note: 'Light and quick.', bytes: 80e6 },
  { id: 'small', repo: 'onnx-community/whisper-small', name: 'Whisper Small', quality: 'Very good', note: 'Recommended. Good with Thai.', bytes: 252e6, default: true },
];

export const defaultSpeechModel = speechModels.find((model) => model.default).id;

/** Downloads are cached as <cache>/<repo>/<file>; a model counts as installed once its weights are there. */
export function speechModelInstalled(cacheDir, model) {
  return ['encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx'].every((file) => existsSync(join(cacheDir, model.repo, 'onnx', file)));
}
