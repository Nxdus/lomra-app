// Local background removal and upscaling worker: run by picture-ai.mjs with ELECTRON_RUN_AS_NODE. Not loaded by the renderer.
import { writeFileSync } from 'node:fs';
import ort from 'onnxruntime-node';
import sharp from 'sharp';

const [operation, modelPath, inputFile, outFile, scaleArg] = process.argv.slice(2);
const maxSide = 8192;
const maxPixels = 36_000_000;
const maxPngBytes = 20 * 1024 * 1024;
const tileSize = 256;
const tilePad = 32;

const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const clampByte = (value) => value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);

/** Encode `raw` RGBA/RGB pixels to PNG within the 20 MB canvas limit. */
async function writePng(raw, width, height, channels) {
  let png = await sharp(raw, { raw: { width, height, channels } }).png({ compressionLevel: 6 }).toBuffer();
  if (png.length > maxPngBytes) {
    png = await sharp(raw, { raw: { width, height, channels } }).png({ compressionLevel: 9 }).toBuffer();
  }
  if (png.length > maxPngBytes) throw new Error('The upscaled PNG exceeds 20 MB. Try 2× or a smaller picture.');
  writeFileSync(outFile, png);
}

/** Bleed nearby visible colors into fully transparent pixels so upscaling does not smear black halos across edges. */
function bleedTransparentRgb(rgba, width, height, passes = 4) {
  let current = Uint8Array.from(rgba);
  for (let pass = 0; pass < passes; pass++) {
    const next = Uint8Array.from(current);
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (current[idx + 3] > 0) continue;
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
            const nIdx = (ny * width + nx) * 4;
            if (current[nIdx + 3] > 0) {
              r += current[nIdx]; g += current[nIdx + 1]; b += current[nIdx + 2]; count++;
            }
          }
        }
        if (count > 0) {
          next[idx] = Math.round(r / count);
          next[idx + 1] = Math.round(g / count);
          next[idx + 2] = Math.round(b / count);
          next[idx + 3] = 1;
          changed = true;
        }
      }
    }
    current = next;
    if (!changed) break;
  }
  return current;
}

async function runRemoveBackground() {
  emit({ stage: 'loading' });
  const oriented = sharp(inputFile).rotate();
  const { data: rgba, info } = await oriented.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width > maxSide || height > maxSide || width * height > maxPixels) {
    throw new Error('Picture exceeds the 8192 px or 36 megapixel limit for local processing.');
  }

  const modelInput = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .flatten({ background: '#808080' })
    .resize(1024, 1024, { fit: 'fill', kernel: 'cubic' })
    .removeAlpha()
    .raw()
    .toBuffer();

  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const plane = 1024 * 1024;
  const tensorData = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    tensorData[i] = (modelInput[i * 3] / 255 - mean[0]) / std[0];
    tensorData[plane + i] = (modelInput[i * 3 + 1] / 255 - mean[1]) / std[1];
    tensorData[2 * plane + i] = (modelInput[i * 3 + 2] / 255 - mean[2]) / std[2];
  }

  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
  try {
    emit({ stage: 'processing', done: 0, total: 1 });
    const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', tensorData, [1, 3, 1024, 1024]) });
    const logits = result[session.outputNames[0]].data;
    const mask1024 = Buffer.alloc(plane);
    for (let i = 0; i < plane; i++) {
      mask1024[i] = clampByte((1 / (1 + Math.exp(-logits[i]))) * 255);
    }
    // `b-w` keeps 1 channel; sharp's default srgb pipeline would expand a resized 1-channel buffer to 3 channels.
    const maskOrig = await sharp(mask1024, { raw: { width: 1024, height: 1024, channels: 1 } })
      .toColourspace('b-w')
      .resize(width, height, { fit: 'fill', kernel: 'cubic' })
      .raw()
      .toBuffer();

    for (let i = 0; i < width * height; i++) {
      rgba[i * 4 + 3] = Math.round((rgba[i * 4 + 3] * maskOrig[i]) / 255);
    }
    emit({ stage: 'processing', done: 1, total: 1 });
    await writePng(rgba, width, height, 4);
  } finally {
    await session.release();
  }
}

async function runUpscale() {
  const scale = Number(scaleArg);
  if (scale !== 2 && scale !== 4) throw new Error('Scale must be 2 or 4.');
  emit({ stage: 'loading' });
  const { data: rgba, info } = await sharp(inputFile).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const outW = width * scale;
  const outH = height * scale;
  if (outW > maxSide || outH > maxSide || outW * outH > maxPixels) {
    throw new Error(`The upscaled picture (${outW}×${outH}) exceeds the ${maxSide} px or 36 megapixel limit. Try ${scale === 4 ? '2× or ' : ''}a smaller picture.`);
  }

  let hasAlpha = false;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 255) { hasAlpha = true; break; }
  }
  const sourceRgba = hasAlpha ? bleedTransparentRgb(rgba, width, height) : rgba;
  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);
  const total = tilesX * tilesY;

  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
  const outRgb = Buffer.alloc(outW * outH * 3);
  try {
    let done = 0;
    emit({ stage: 'processing', done, total });
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const x0 = tx * tileSize;
        const y0 = ty * tileSize;
        const x1 = Math.min(width, x0 + tileSize);
        const y1 = Math.min(height, y0 + tileSize);
        const px0 = Math.max(0, x0 - tilePad);
        const py0 = Math.max(0, y0 - tilePad);
        const px1 = Math.min(width, x1 + tilePad);
        const py1 = Math.min(height, y1 + tilePad);
        const tw = px1 - px0;
        const th = py1 - py0;
        const plane = tw * th;

        const inputData = new Float32Array(3 * plane);
        for (let y = 0; y < th; y++) {
          const sy = py0 + y;
          for (let x = 0; x < tw; x++) {
            const sx = px0 + x;
            const srcIdx = (sy * width + sx) * 4;
            const dstIdx = y * tw + x;
            inputData[dstIdx] = sourceRgba[srcIdx] / 255;
            inputData[plane + dstIdx] = sourceRgba[srcIdx + 1] / 255;
            inputData[2 * plane + dstIdx] = sourceRgba[srcIdx + 2] / 255;
          }
        }

        const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', inputData, [1, 3, th, tw]) });
        const outTensor = result[session.outputNames[0]].data;
        const modelScale = 4;
        const upW = tw * modelScale;
        const upH = th * modelScale;
        const upPlane = upW * upH;

        let tileRgb = Buffer.alloc(upPlane * 3);
        for (let i = 0; i < upPlane; i++) {
          tileRgb[i * 3] = clampByte(outTensor[i] * 255);
          tileRgb[i * 3 + 1] = clampByte(outTensor[upPlane + i] * 255);
          tileRgb[i * 3 + 2] = clampByte(outTensor[2 * upPlane + i] * 255);
        }
        let tileStrideW = upW;
        if (scale === 2) {
          tileStrideW = tw * 2;
          tileRgb = await sharp(tileRgb, { raw: { width: upW, height: upH, channels: 3 } })
            .resize(tileStrideW, th * 2, { fit: 'fill', kernel: 'lanczos3' })
            .raw()
            .toBuffer();
        }

        const cropL = (x0 - px0) * scale;
        const cropT = (y0 - py0) * scale;
        const copyW = (x1 - x0) * scale;
        const copyH = (y1 - y0) * scale;
        for (let y = 0; y < copyH; y++) {
          const srcStart = ((cropT + y) * tileStrideW + cropL) * 3;
          const dstStart = ((y0 * scale + y) * outW + x0 * scale) * 3;
          tileRgb.copy(outRgb, dstStart, srcStart, srcStart + copyW * 3);
        }

        done++;
        emit({ stage: 'processing', done, total });
      }
    }
  } finally {
    await session.release();
  }

  if (hasAlpha) {
    const alphaIn = Buffer.alloc(width * height);
    for (let i = 0; i < width * height; i++) alphaIn[i] = rgba[i * 4 + 3];
    const alphaOut = await sharp(alphaIn, { raw: { width, height, channels: 1 } })
      .toColourspace('b-w')
      .resize(outW, outH, { fit: 'fill', kernel: 'cubic' })
      .raw()
      .toBuffer();
    const outRgba = Buffer.alloc(outW * outH * 4);
    for (let i = 0; i < outW * outH; i++) {
      outRgba[i * 4] = outRgb[i * 3];
      outRgba[i * 4 + 1] = outRgb[i * 3 + 1];
      outRgba[i * 4 + 2] = outRgb[i * 3 + 2];
      outRgba[i * 4 + 3] = alphaOut[i];
    }
    await writePng(outRgba, outW, outH, 4);
  } else {
    await writePng(outRgb, outW, outH, 3);
  }
}

process.stdin.on('close', () => process.exit(0)).resume();

try {
  if (operation === 'remove-background') await runRemoveBackground();
  else if (operation === 'upscale') await runUpscale();
  else throw new Error('Unknown picture operation.');
  process.exit(0);
} catch (cause) {
  emit({ stage: 'error', message: cause instanceof Error ? cause.message : 'Local picture processing failed.' });
  process.exit(1);
}
