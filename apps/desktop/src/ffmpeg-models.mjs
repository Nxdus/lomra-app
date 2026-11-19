/**
 * Joining the clips of a storyboard into one video runs ffmpeg. The build below is pinned: the download is checked
 * against its SHA-256 before it is used, and it is fetched only after the user agrees.
 * LGPL builds carry no x264, so the software H.264 encoder is `libopenh264`.
 * BtbN keeps only recent autobuild tags; when this one is pruned, pin a newer tag and update `asset`, `sha256` and `bytes`.
 */
export const ffmpegRelease = 'autobuild-2026-11-19-12-39';

/** The ffmpeg build per `<platform>-<arch>`. Platforms without an entry cannot join clips yet. */
export const ffmpegBuilds = {
  'win32-x64': {
    asset: 'ffmpeg-n8.1.3-36-ge22a4510c9-win64-lgpl-8.1.zip',
    sha256: '7de8169d58f330c39fa1a6ab96bfd1a2918ad5d851360fd7d5f99f8b97e2c5aa', bytes: 170931586,
  },
};

export const ffmpegUrl = (build) => `https://github.com/BtbN/FFmpeg-Builds/releases/download/${ffmpegRelease}/${build.asset}`;

export const maxClips = 12;
export const maxClipBytes = 100 * 1024 * 1024;
export const maxTotalBytes = 600 * 1024 * 1024;
const fps = 24;

/** Output size for a few common aspect ratios (the long side is 1280). */
export function videoSize(aspectRatio = '16:9') {
  const sizes = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720], '4:3': [960, 720], '3:4': [720, 960] };
  const [width, height] = sizes[aspectRatio] ?? sizes['16:9'];
  return { width, height, fps };
}

/** `{ audio, seconds }` from what `ffmpeg -i file` prints. */
export function parseProbe(text) {
  const time = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  return {
    audio: /Stream #\d+:\d+[^\n]*: Audio:/.test(text),
    seconds: time ? Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]) : 0,
  };
}

/**
 * ffmpeg arguments that join `clips` (`{ file, seconds, audio }`) into `out`: every clip is scaled to one size and
 * frame rate, cut to its shot length (a short clip holds its last frame), and given silence when it has no sound.
 */
export function buildStitchArgs(clips, { width, height, fps: rate }, out) {
  const inputs = clips.flatMap(({ file }) => ['-i', file]);
  const parts = clips.map(({ seconds, audio }, index) => {
    const length = seconds.toFixed(3);
    const video = `[${index}:v:0]fps=${rate},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${length},trim=duration=${length},setpts=PTS-STARTPTS[v${index}]`;
    const sound = audio
      ? `[${index}:a:0]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${length},asetpts=PTS-STARTPTS[a${index}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${length},asetpts=PTS-STARTPTS[a${index}]`;
    return `${video};${sound}`;
  });
  const joined = clips.map((_, index) => `[v${index}][a${index}]`).join('');
  const graph = `${parts.join(';')};${joined}concat=n=${clips.length}:v=1:a=1[v][a]`;
  return ['-hide_banner', '-nostdin', '-y', ...inputs, '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libopenh264', '-b:v', '6M', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out];
}
