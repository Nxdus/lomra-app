const SAMPLE_RATE = 16000;

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate = SAMPLE_RATE): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true));
  return new Blob([view], { type: "audio/wav" });
}

/** Decode a recording (MediaRecorder gives WebM/Opus) to 16 kHz mono WAV, which every Whisper backend accepts. */
export async function toWav(recording: Blob): Promise<Blob> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      decoded.getChannelData(channel).forEach((sample, i) => { mono[i] += sample / decoded.numberOfChannels; });
    }
    return encodeWav(mono, decoded.sampleRate);
  } finally {
    void context.close();
  }
}
