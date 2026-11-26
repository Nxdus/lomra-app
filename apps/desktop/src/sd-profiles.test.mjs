import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSd } from './sd.mjs';
import { sdInput } from './sd-input.mjs';
import { customModelId, sdEngines, sdModels } from './sd-models.mjs';
import { sdProfiles } from './sd-profiles.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const runId = '11111111-1111-1111-1111-111111111111';

const png = (width, height, color = 'x') => {
  const bytes = Buffer.alloc(40, color);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString('base64')}`;
};

function safetensors(tensors) {
  const json = Buffer.from(JSON.stringify({ __metadata__: { format: 'pt' }, ...Object.fromEntries(Object.entries(tensors).map(([name, shape]) => [name, { dtype: 'F16', shape, data_offsets: [0, 0] }])) }));
  const size = Buffer.alloc(8);
  size.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([size, json, Buffer.alloc(64)]);
}

const checkpoint = ({ channels = 4, context = 768, level = 1, text = 'cond_stage_model.x', vae = 'first_stage_model.x' } = {}) => ({
  'model.diffusion_model.input_blocks.0.0.weight': [320, channels, 3, 3],
  [`model.diffusion_model.input_blocks.${level}.1.transformer_blocks.0.attn2.to_k.weight`]: [320, context],
  [text]: [1], [vae]: [1],
});

function setupBuiltIns() {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-sd-profiles-'));
  const engineDir = join(dir, 'engine', 'master-1106-532d2c1');
  const modelsDir = join(dir, 'models');
  mkdirSync(engineDir, { recursive: true });
  mkdirSync(modelsDir, { recursive: true });
  writeFileSync(join(engineDir, 'sd-cli.exe'), 'bin');
  for (const model of sdModels) writeFileSync(join(modelsDir, `${model.id}.safetensors`), 'weights');
  const calls = [];
  const spawnProcess = (_command, args) => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => proc.emit('exit', null);
    calls.push(args);
    queueMicrotask(() => {
      writeFileSync(args[args.indexOf('-o') + 1], 'png');
      proc.emit('exit', 0);
    });
    return proc;
  };
  const sd = createSd({ dir, platform: 'win32', arch: 'x64', env: {}, spawnProcess });
  return { dir, sd, calls };
}

test('built-in models keep their exact defaults, ranges and engine args from e2ac95e for text, image-to-image and inpaint', async () => {
  const { dir, sd, calls } = setupBuiltIns();
  try {
    const status = sd.status();
    expect(status.profiles.map((p) => p.id)).toEqual(['sd15', 'sdxl', 'turbo', 'sdxl-few']);
    expect(status.models.find((m) => m.id === 'sd-turbo').profile).toMatchObject({
      id: 'turbo', size: 512, steps: 4, cfg: 1,
      ranges: { steps: { min: 1, max: 50, whole: true }, cfg: { min: 0, max: 20, whole: false }, strength: { min: 0, max: 1, whole: false } },
      capabilities: { textToImage: true, imageToImage: true, inpaint: true, negativePrompt: true, cfg: true, strength: true, outpaint: false, referencePictures: false },
    });
    expect(status.models.find((m) => m.id === 'sdxl-turbo').profile.id).toBe('turbo');
    expect(status.models.find((m) => m.id === 'sd15').profile).toMatchObject({
      id: 'sd15', size: 512, steps: 20, cfg: 7,
      capabilities: { negativePrompt: true, cfg: true, outpaint: false, referencePictures: false },
    });

    const image = png(1500, 1000);
    const mask = png(1500, 1000, 'm');
    const erasePrompt = 'plain empty background, natural continuation, nothing there';
    const eraseNegative = 'object, person, animal, text, watermark, frame, border';
    const out = join(dir, 'out', runId, 'out.png');
    const init = join(dir, 'out', runId, 'init.png');
    const maskPath = join(dir, 'out', runId, 'mask.png');

    for (const [index, [model, defaultSteps, defaultCfg, maskCfg]] of [
      ['sd-turbo', '4', '1', '1'],
      ['sdxl-turbo', '4', '1', '1'],
      ['sd15', '20', '7', '4'],
    ].entries()) {
      const weights = join(dir, 'models', `${model}.safetensors`);
      const base = index * 3;

      await sd.generate(runId, { model, prompt: 'fox', seed: 1 });
      expect(calls[base]).toEqual(['-m', weights, '-p', 'fox', '-o', out, '-W', '512', '-H', '512', '--steps', defaultSteps, '--cfg-scale', defaultCfg, '-s', '1', '--vae-tiling']);

      await sd.generate(runId, { model, prompt: 'fox', seed: 2, image });
      expect(calls[base + 1]).toEqual([
        '-m', weights, '-p', 'fox', '-o', out, '-W', '576', '-H', '384', '--steps', defaultSteps, '--cfg-scale', defaultCfg, '-s', '2',
        '-i', init, '--image-preprocess', 'target=init,mode=stretch,filter=bicubic,antialias=true', '--strength', '0.75',
      ]);

      await sd.generate(runId, { model, prompt: erasePrompt, negativePrompt: eraseNegative, strength: 1, seed: 3, image, mask });
      expect(calls[base + 2]).toEqual([
        '-m', weights, '-p', erasePrompt, '-o', out, '-W', '576', '-H', '384', '--steps', defaultSteps, '--cfg-scale', maskCfg, '-s', '3', '-n', eraseNegative,
        '-i', init, '--image-preprocess', 'target=init,mode=stretch,filter=bicubic,antialias=true',
        '--mask', maskPath, '--image-preprocess', 'target=mask,mode=stretch', '--strength', '1',
      ]);
    }

    // Few-step models still accept custom steps, CFG and negative prompt as on e2ac95e.
    await sd.generate(runId, { model: 'sd-turbo', prompt: 'fox', negativePrompt: 'blur', steps: 20, cfg: 1.5, seed: 4 });
    expect(calls.at(-1)).toEqual([
      '-m', join(dir, 'models', 'sd-turbo.safetensors'), '-p', 'fox', '-o', out, '-W', '512', '-H', '512', '--steps', '20', '--cfg-scale', '1.5', '-s', '4', '--vae-tiling', '-n', 'blur',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a fake extra profile appears in status and is enforced by sd-input without other code changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-sd-fake-'));
  const fakeProfile = {
    id: 'fake-edit',
    name: 'Fake Edit',
    note: '768 px, 8 steps',
    size: 768,
    steps: 8,
    cfg: 1,
    strength: 0.6,
    headerTypes: ['sdxl'],
    ranges: {
      steps: { min: 4, max: 80, whole: true },
      cfg: { min: 1, max: 1, whole: false },
      strength: { min: 0.2, max: 0.8, whole: false },
    },
    capabilities: {
      textToImage: false,
      imageToImage: true,
      inpaint: false,
      negativePrompt: false,
      cfg: false,
      strength: true,
      outpaint: false,
      referencePictures: false,
    },
  };
  const fakeModel = {
    id: 'fake-model', name: 'Fake Model', quality: 'Fake', note: '', repo: 'a/b', file: 'fake.safetensors',
    sha256: sha('x'), bytes: 1, profile: 'fake-edit',
  };
  try {
    const engineDir = join(dir, 'engine', 'master-1106-532d2c1');
    const modelsDir = join(dir, 'models');
    mkdirSync(engineDir, { recursive: true });
    mkdirSync(modelsDir, { recursive: true });
    writeFileSync(join(engineDir, 'sd-cli.exe'), 'bin');
    writeFileSync(join(modelsDir, 'fake-model.safetensors'), 'weights');
    const sd = createSd({ dir, platform: 'win32', arch: 'x64', profiles: [...sdProfiles, fakeProfile], models: [fakeModel], engines: sdEngines });
    const status = sd.status();
    expect(status.profiles.some((p) => p.id === 'fake-edit')).toBe(true);
    expect(status.models[0].profile).toMatchObject({ id: 'fake-edit', size: 768, steps: 8, cfg: 1 });

    const image = png(64, 64);
    expect(() => sdInput({ prompt: 'edit' }, fakeProfile)).toThrow('needs a picture');
    expect(() => sdInput({ prompt: 'edit', image, mask: image }, fakeProfile)).toThrow('brushed area');
    expect(() => sdInput({ prompt: 'edit', image, negativePrompt: 'bad' }, fakeProfile)).toThrow('negative prompt');
    expect(() => sdInput({ prompt: 'edit', image, cfg: 5 }, fakeProfile)).toThrow('fixed CFG');
    // Hard upper limit (50) still wins over profile max (80).
    expect(() => sdInput({ prompt: 'edit', image, steps: 51 }, fakeProfile)).toThrow('4 to 50 steps');
    expect(() => sdInput({ prompt: 'edit', image, steps: 3 }, fakeProfile)).toThrow('4 to 50 steps');
    expect(() => sdInput({ prompt: 'edit', image, strength: 0.9 }, fakeProfile)).toThrow('0.2 to 0.8');
    expect(() => sdInput({ prompt: 'edit', image, outpaint: true }, fakeProfile)).toThrow('new shape');
    expect(() => sdInput({ prompt: 'edit', image, images: [image] }, fakeProfile)).toThrow('reference pictures');
    expect(sdInput({ prompt: 'edit', image, steps: 10, strength: 0.5 }, fakeProfile).settings).toMatchObject({ steps: 10, cfg: 1, strength: 0.5 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installed Hugging Face models expose compatible profiles and can switch profiles with header validation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lomra-sd-setprofile-'));
  const customDir = join(dir, 'custom');
  mkdirSync(customDir, { recursive: true });
  const sd15File = 'model-sd15.safetensors';
  const sdxlFile = 'model-sdxl.safetensors';
  const sd15Id = customModelId('a/b', sd15File);
  const sdxlId = customModelId('a/b', sdxlFile);
  writeFileSync(join(customDir, `${sd15Id}.safetensors`), safetensors(checkpoint()));
  writeFileSync(join(customDir, `${sd15Id}.json`), JSON.stringify({ id: sd15Id, repo: 'a/b', file: sd15File, family: 'turbo', bytes: 100, sha256: 'a'.repeat(64), local: true, extra: { source: 'disk' } }));
  writeFileSync(join(customDir, `${sdxlId}.safetensors`), safetensors(checkpoint({ context: 2048, level: 4, text: 'conditioner.embedders.0.x' })));
  writeFileSync(join(customDir, `${sdxlId}.json`), JSON.stringify({ id: sdxlId, repo: 'a/b', file: sdxlFile, family: 'sdxl', bytes: 100, sha256: 'b'.repeat(64) }));

  try {
    const sd = createSd({ dir, platform: 'win32', arch: 'x64' });
    await sd.probe();
    const before15 = sd.status().models.find((m) => m.id === sd15Id);
    const beforeXl = sd.status().models.find((m) => m.id === sdxlId);
    expect(before15.profile.id).toBe('turbo');
    expect(before15.compatibleProfiles).toEqual(['sd15', 'turbo']);
    expect(beforeXl.compatibleProfiles).toEqual(['sdxl', 'turbo', 'sdxl-few']);

    expect(await sd.setProfile(sd15Id, 'sdxl')).toBe(false);
    expect(await sd.setProfile(sd15Id, 'sdxl-few')).toBe(false);
    expect(await sd.setProfile(sd15Id, 'nope')).toBe(false);
    expect(await sd.setProfile('sd-turbo', 'sd15')).toBe(false);
    expect(await sd.setProfile(sd15Id, 'sd15')).toBe(true);
    expect(await sd.setProfile(sdxlId, 'sdxl-few')).toBe(true);

    expect(JSON.parse(readFileSync(join(customDir, `${sd15Id}.json`), 'utf8'))).toEqual({
      id: sd15Id, repo: 'a/b', file: sd15File, family: 'sd15', bytes: 100, sha256: 'a'.repeat(64), local: true, extra: { source: 'disk' },
    });
    expect(JSON.parse(readFileSync(join(customDir, `${sdxlId}.json`), 'utf8')).family).toBe('sdxl-few');
    expect(readdirSync(customDir).some((name) => name.endsWith('.tmp'))).toBe(false);

    // Reloading from disk preserves the updated profile.
    const reloaded = createSd({ dir, platform: 'win32', arch: 'x64' });
    await reloaded.probe();
    expect(reloaded.status().models.find((m) => m.id === sd15Id).profile.id).toBe('sd15');
    expect(reloaded.status().models.find((m) => m.id === sdxlId).profile.id).toBe('sdxl-few');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
