import type { GeneratedFile } from "./generation";
import { canvasFileKind } from "@/lib/image-canvas/image-canvas-storage";

export type MediaTool =
  | { name: "rig_3d"; model_index: number }
  | { name: "animate_3d"; model_index: number; animation?: "idle" | "walk" | "run" | "wave" | "dance"; motion_prompt?: string; duration?: number }
  | { name: "remove_background"; image_index: number }
  | { name: "upscale_image"; image_index: number; scale: number }
  | { name: "extract_video_frames"; video_index: number; timestamps: number[] }
  | { name: "trim_video"; video_index: number; start: number; end: number }
  | { name: "inspect_3d"; model_index: number }
  | { name: "optimize_3d"; model_index: number; max_texture_size?: number; target_triangles?: number; language?: "en" | "th" }
  | { name: "render_3d_views"; model_index: number; views: string[] };
export type ToolSource = { file: File; url: string };
export const viewAngles: Record<string, number> = { front: 0, right: 90, back: 180, left: 270 };
export function validateMediaTool(value: unknown): asserts value is MediaTool {
  const tool = value as MediaTool;
  const index = (n: number) => Number.isInteger(n) && n >= 0 && n < 10;
  const time = (n: number) => Number.isFinite(n) && n >= 0;
  if (!tool || !(
    (tool.name === "rig_3d" && index(tool.model_index)) ||
    (tool.name === "animate_3d" && index(tool.model_index) && ((tool.motion_prompt === undefined && ["idle", "walk", "run", "wave", "dance"].includes(tool.animation ?? "")) || (tool.animation === undefined && typeof tool.motion_prompt === "string" && tool.motion_prompt.trim().length > 0 && tool.motion_prompt.length <= 400)) && (tool.duration === undefined || (Number.isFinite(tool.duration) && tool.duration >= 2 && tool.duration <= 10 && Number.isInteger(tool.duration * 2)))) ||
    (tool.name === "remove_background" && index(tool.image_index)) ||
    (tool.name === "upscale_image" && index(tool.image_index) && [2, 4].includes(tool.scale)) ||
    (tool.name === "extract_video_frames" && index(tool.video_index) && Array.isArray(tool.timestamps) && tool.timestamps.length > 0 && tool.timestamps.length <= 16 && tool.timestamps.every(time)) ||
    (tool.name === "trim_video" && index(tool.video_index) && time(tool.start) && time(tool.end) && tool.end > tool.start && tool.end - tool.start <= 120) ||
    (tool.name === "inspect_3d" && index(tool.model_index)) ||
    (tool.name === "optimize_3d" && index(tool.model_index) && (tool.language === undefined || ["en", "th"].includes(tool.language)) && (tool.max_texture_size === undefined || [512, 1024, 2048, 4096].includes(tool.max_texture_size)) && (tool.target_triangles === undefined || (Number.isInteger(tool.target_triangles) && (tool.target_triangles === 0 || tool.target_triangles >= 4) && tool.target_triangles <= 5_000_000))) ||
    (tool.name === "render_3d_views" && index(tool.model_index) && Array.isArray(tool.views) && tool.views.length > 0 && tool.views.length <= 4 && new Set(tool.views).size === tool.views.length && tool.views.every(v => Object.hasOwn(viewAngles, v)))
  )) throw new Error("Invalid media tool arguments");
}
export const pictureAiPrefix = "local-picture/";
export const isLocalPictureModel = (model: string) => model.startsWith(pictureAiPrefix);
export function pictureAiOperation(tool: MediaTool): "remove-background" | "upscale" | undefined {
  if (tool.name === "remove_background") return "remove-background";
  if (tool.name === "upscale_image") return "upscale";
  return undefined;
}
export function mediaToolModel(tool: MediaTool, localModelId?: string) {
  if (tool.name === "rig_3d") return "fal-ai/meshy/rigging";
  if (tool.name === "animate_3d") return tool.motion_prompt ? "fal-ai/hunyuan-motion" : "fal-ai/meshy/rigging";
  if (tool.name === "remove_background") return localModelId ? `${pictureAiPrefix}${localModelId}` : "fal-ai/birefnet/v2";
  if (tool.name === "upscale_image") return localModelId ? `${pictureAiPrefix}${localModelId}` : "fal-ai/esrgan";
  return "Local media tools";
}
export function validMediaToolModel(tool: MediaTool, model: string) {
  return model === mediaToolModel(tool) || (pictureAiOperation(tool) !== undefined && isLocalPictureModel(model));
}

function waitEvent(target: EventTarget, event: string, signal: AbortSignal, timeout = 30_000) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(event, done); target.removeEventListener("error", failed); signal.removeEventListener("abort", aborted); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Could not load or process selected media.")); };
    const aborted = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Media processing timed out.")); }, timeout);
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function seek(video: HTMLVideoElement, seconds: number, signal: AbortSignal) {
  if (video.currentTime === seconds && video.readyState >= 2) return;
  const ready = waitEvent(video, "seeked", signal);
  video.currentTime = seconds;
  await ready;
}

export async function localMediaTool(tool: MediaTool, sources: ToolSource[], signal: AbortSignal, report: (summary: string) => void = () => {}): Promise<GeneratedFile[]> {
  validateMediaTool(tool);
  signal.throwIfAborted();
  if (tool.name === "remove_background" || tool.name === "upscale_image" || tool.name === "animate_3d" || tool.name === "rig_3d") throw new Error("This tool requires Fal.");
  if (tool.name === "inspect_3d" || tool.name === "optimize_3d") {
    const source = sources.filter(s => canvasFileKind(s.file) === "3d")[tool.model_index];
    if (!source) throw new Error("Select a GLB model on the canvas first.");
    return (await import("./model-tools")).processModel(tool, source.file, signal, report);
  }
  if (tool.name === "render_3d_views") {
    const source = sources.filter(s => canvasFileKind(s.file) === "3d")[tool.model_index];
    if (!source) throw new Error("Select a GLB model on the canvas first.");
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const { MeshoptDecoder } = await import("meshoptimizer");
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(await source.file.arrayBuffer(), "");
    let renderer: InstanceType<typeof THREE.WebGLRenderer> | undefined;
    const files: GeneratedFile[] = [];
    try {
      signal.throwIfAborted();
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
      if (!Number.isFinite(radius) || radius <= 0) throw new Error("Model has no renderable geometry.");
      const scene = new THREE.Scene();
      scene.add(gltf.scene, new THREE.HemisphereLight(0xffffff, 0x666666, 3));
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(1, 2, 3); scene.add(light);
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setSize(1024, 1024);
      const margin = radius * 1.1;
      const camera = new THREE.OrthographicCamera(-margin, margin, margin, -margin, radius * 0.01, radius * 10);
      for (const view of tool.views) {
        signal.throwIfAborted();
        const angle = viewAngles[view] * Math.PI / 180;
        camera.position.set(center.x + Math.sin(angle) * radius * 3, center.y, center.z + Math.cos(angle) * radius * 3);
        camera.lookAt(center);
        renderer.render(scene, camera);
        files.push({ url: renderer.domElement.toDataURL("image/png"), name: view, kind: "image" });
      }
      return files;
    } finally {
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
          material.dispose();
        }
      });
      renderer?.dispose(); renderer?.forceContextLoss();
    }
  }
  const source = sources.filter(s => canvasFileKind(s.file) === "video")[tool.video_index];
  if (!source) throw new Error("Select a video on the canvas first.");
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  try {
    const ready = waitEvent(video, "loadeddata", signal);
    video.src = source.url;
    await ready;
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("Video has no finite duration.");
    if (tool.name === "extract_video_frames") {
      if (tool.timestamps.some(t => t >= video.duration)) throw new Error("Frame timestamps must be before the end of the video.");
      if (video.videoWidth * video.videoHeight > 32_000_000) throw new Error("Video frames are too large.");
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Frame extraction is unavailable.");
      const files: GeneratedFile[] = [];
      for (const timestamp of tool.timestamps) {
        await seek(video, timestamp, signal);
        signal.throwIfAborted();
        ctx.drawImage(video, 0, 0);
        files.push({ url: canvas.toDataURL("image/png"), name: `Frame ${timestamp}s`, kind: "image" });
      }
      canvas.width = canvas.height = 0;
      return files;
    }
    if (tool.end > video.duration) throw new Error("Trim range exceeds the video duration.");
    // shortcut: real-time WebM recording; use an offline muxer for frame-accurate cuts or longer clips.
    const capture = video as HTMLVideoElement & { captureStream?: () => MediaStream };
    const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(t => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
    if (!capture.captureStream || !mime) throw new Error("Video trimming needs a browser supporting captureStream and WebM recording, such as Chrome.");
    await seek(video, tool.start, signal);
    // Draw decoded frames explicitly: detached video capture can freeze its video track.
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    if (canvas.width * canvas.height > 8_300_000) throw new Error("Video trimming supports up to 4K frames.");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Video trimming is unavailable.");
    ctx.drawImage(video, 0, 0);
    const audioStream = capture.captureStream();
    const stream = canvas.captureStream(30);
    audioStream.getAudioTracks().forEach(track => stream.addTrack(track));
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = waitEvent(recorder, "stop", signal, (tool.end - tool.start) * 1000 + 30_000);
    // Attach a handler immediately: play() can fail before we await recording completion.
    void stopped.catch(() => {});
    const stop = () => { if (recorder.state !== "inactive") recorder.stop(); };
    const check = () => { if (video.currentTime >= tool.end) stop(); };
    video.addEventListener("timeupdate", check);
    video.addEventListener("ended", stop);
    signal.addEventListener("abort", stop, { once: true });
    const draw = setInterval(() => { ctx.drawImage(video, 0, 0); check(); }, 1000 / 30);
    try {
      recorder.start();
      await video.play();
      await stopped;
      signal.throwIfAborted();
      if (!chunks.length) throw new Error("Video recording returned no data.");
      return [{ url: URL.createObjectURL(new Blob(chunks, { type: "video/webm" })), name: `Clip ${tool.start}-${tool.end}s`, kind: "video" }];
    } finally {
      clearInterval(draw); stop();
      stream.getTracks().forEach(t => t.stop());
      audioStream.getTracks().forEach(t => t.stop());
      video.removeEventListener("timeupdate", check); video.removeEventListener("ended", stop); signal.removeEventListener("abort", stop);
    }
  } finally { video.pause(); video.removeAttribute("src"); video.load(); }
}
