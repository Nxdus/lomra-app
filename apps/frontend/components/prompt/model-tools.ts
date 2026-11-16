import { WebIO, type Document, type Texture } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { compressTexture, dedup, prune, simplifyPrimitive, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import type { GeneratedFile } from "./generation";
import { validateMediaTool, type MediaTool } from "./media-tools";

type ModelTool = Extract<MediaTool, { name: "inspect_3d" | "optimize_3d" }>;

export async function resizeLargeTexture(texture: Texture, limit: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const [width, height] = texture.getSize()!;
  const scale = Math.min(1, limit / Math.max(width, height));
  // Decode at the target size instead of allocating full-resolution JS pixel arrays.
  const bitmap = await createImageBitmap(new Blob([texture.getImage()! as Uint8Array<ArrayBuffer>], { type: texture.getMimeType() }), {
    resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)), resizeQuality: "high",
  });
  const canvas = document.createElement("canvas");
  try {
    signal.throwIfAborted();
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Texture resizing is unavailable in this browser.");
    context.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not encode resized texture.")), texture.getMimeType(), 0.92));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    signal.throwIfAborted();
    texture.setImage(bytes).setMimeType(blob.type);
  } finally { bitmap.close(); canvas.width = canvas.height = 0; }
}

function statistics(document: Document, bytes: number) {
  const root = document.getRoot();
  let triangles = 0, vertices = 0;
  for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
    vertices += primitive.getAttribute("POSITION")?.getCount() ?? 0;
    if (primitive.getMode() === 4) triangles += Math.floor(count / 3);
    else if (primitive.getMode() === 5 || primitive.getMode() === 6) triangles += Math.max(0, count - 2);
  }
  return {
    bytes, triangles, vertices, meshes: root.listMeshes().length, materials: root.listMaterials().length,
    skins: root.listSkins().length, animations: root.listAnimations().length,
    textures: root.listTextures().map(t => ({ name: t.getName(), dimensions: t.getSize(), bytes: t.getImage()?.byteLength ?? 0 })),
  };
}

export function optimizationReport(before: ReturnType<typeof statistics>, after: ReturnType<typeof statistics>, target: number, warnings: string[], language: "en" | "th" = "en") {
  const th = language === "th";
  const number = (value: number) => value.toLocaleString("en-US");
  const size = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} MB` : value >= 1000 ? `${(value / 1000).toFixed(1)} KB` : `${number(value)} bytes`;
  const improved = after.bytes < before.bytes || after.triangles < before.triangles;
  const reduction = before.bytes ? (1 - after.bytes / before.bytes) * 100 : 0;
  const textures = (stats: typeof before) => {
    const counts = new Map<string, number>();
    for (const texture of stats.textures) {
      const dimensions = texture.dimensions?.join(" × ") ?? (th ? "ไม่ทราบขนาด" : "Unknown size");
      counts.set(dimensions, (counts.get(dimensions) ?? 0) + 1);
    }
    return [...counts].map(([dimensions, count]) => `${dimensions} px (${count})`).join(", ") || "—";
  };
  return [
    improved ? (th ? "**ปรับโมเดล 3D เรียบร้อยแล้ว**" : "**3D model optimized**") : (th ? "**โมเดลนี้ยังลดขนาดเพิ่มเติมไม่ได้**" : "**No further reduction achieved**"),
    "",
    ...(improved ? [th ? `ไฟล์${reduction >= 0 ? "เล็กลง" : "ใหญ่ขึ้น"} **${Math.abs(reduction).toFixed(1)}%**${after.triangles < before.triangles ? ` และลด triangles ลง **${((1 - after.triangles / before.triangles) * 100).toFixed(1)}%**` : ""}` : `File is **${Math.abs(reduction).toFixed(1)}% ${reduction >= 0 ? "smaller" : "larger"}**${after.triangles < before.triangles ? ` with **${((1 - after.triangles / before.triangles) * 100).toFixed(1)}% fewer triangles**` : ""}.`, ""] : []),
    th ? "| รายการ | ก่อน | หลัง |" : "| Metric | Before | After |",
    "| --- | ---: | ---: |",
    `| ${th ? "ขนาดไฟล์" : "File size"} | ${size(before.bytes)} | ${size(after.bytes)} |`,
    `| Triangles | ${number(before.triangles)} | ${number(after.triangles)} |`,
    `| Vertices | ${number(before.vertices)} | ${number(after.vertices)} |`,
    ...(before.textures.length || after.textures.length ? [`| Textures | ${textures(before)} | ${textures(after)} |`] : []),
    "",
    ...(improved && target > 0 && after.triangles <= target && after.triangles < before.triangles ? [th ? `ลดถึงเป้าหมาย ${number(target)} triangles แล้ว` : `Reached the target of ${number(target)} triangles.`, ""] : []),
    th ? (improved ? "เก็บต้นฉบับไว้แล้ว และสร้าง GLB ใหม่สำหรับผลลัพธ์นี้ รายละเอียดรูปทรงและ texture อาจลดลง ควรตรวจโมเดลก่อนนำไปใช้" : "เก็บต้นฉบับไว้ตามเดิม ไม่ได้สร้างไฟล์ใหม่") : (improved ? "Original preserved; the result is a new GLB. Geometry and texture detail may decrease; check the model before use." : "Original preserved. No new file was created."),
    ...(warnings.length ? ["", th ? "ข้อสังเกต:" : "Warnings:", "", ...warnings.map(warning => `- ${warning}`)] : []),
  ].join("\n");
}

export async function processModel(tool: ModelTool, file: File, signal: AbortSignal, report: (summary: string) => void): Promise<GeneratedFile[]> {
  validateMediaTool(tool);
  signal.throwIfAborted();
  if (file.size > 100 * 1024 * 1024) throw new Error("Model tools support GLB files up to 100 MB.");
  await MeshoptDecoder.ready;
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const input = new Uint8Array(await file.arrayBuffer());
  const json = await io.binaryToJSON(input);
  // Reject unsupported extensions instead of silently discarding their data on export.
  const supported = new Set(ALL_EXTENSIONS.map(extension => extension.EXTENSION_NAME));
  for (const extension of json.json.extensionsUsed ?? []) {
    if (!supported.has(extension)) throw new Error(`Unsupported GLB extension: ${extension}. Original preserved.`);
  }
  for (const resource of [...(json.json.buffers ?? []), ...(json.json.images ?? [])]) {
    if (resource.uri && !resource.uri.startsWith("data:")) throw new Error("Use a self-contained GLB with embedded resources.");
  }
  if (json.json.extensionsUsed?.includes("KHR_draco_mesh_compression")) throw new Error("Draco-compressed input is not supported yet. Use an uncompressed GLB.");
  signal.throwIfAborted();
  const document = await io.readJSON(json);
  signal.throwIfAborted();
  const before = statistics(document, file.size);
  if (tool.name === "inspect_3d") {
    report(`3D inspection (stored geometry, not per-frame draw counts): ${JSON.stringify(before)}`);
    return [];
  }
  // Export ordinary GLB so optimized files work with existing viewers and importers.
  document.getRoot().listExtensionsUsed().find(e => e.extensionName === "EXT_meshopt_compression")?.dispose();
  signal.throwIfAborted();
  await document.transform(
    dedup(),
    prune({ keepLeaves: true, keepAttributes: true, keepSolidTextures: true, keepExtras: true }),
  );
  const limit = tool.max_texture_size ?? 2048;
  const warnings: string[] = [];
  const target = tool.target_triangles ?? Math.max(4, Math.floor(before.triangles / 2));
  if (target > 0 && target < before.triangles) {
    await MeshoptSimplifier.ready;
    await document.transform(weld());
    const ratio = target / before.triangles;
    for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
      signal.throwIfAborted();
      if (![4, 5, 6].includes(primitive.getMode())) continue;
      const indices = primitive.getIndices()?.getCount() ?? 0;
      const triangles = primitive.getMode() === 4 ? indices / 3 : Math.max(0, indices - 2);
      // Keep small parts and non-triangle geometry; compact all UV, skin and morph attributes together.
      if (triangles <= 4) continue;
      simplifyPrimitive(primitive, { simplifier: MeshoptSimplifier, ratio: Math.max(4 / triangles, ratio), error: 0.01, lockBorder: true });
    }
    const actual = statistics(document, 0).triangles;
    if (actual > target) warnings.push(tool.language === "th" ? `ยังลดไม่ถึงเป้าหมาย ${target.toLocaleString("en-US")} triangles (ได้ ${actual.toLocaleString("en-US")}) เพื่อรักษารูปทรง ขอบโมเดล และชิ้นส่วนขนาดเล็ก` : `Triangle target ${target} not reached (actual ${actual}); shape-error limits, protected borders or small parts prevented further reduction.`);
  }
  for (const texture of document.getRoot().listTextures()) {
    signal.throwIfAborted();
    const size = texture.getSize();
    if (!size || !["image/png", "image/jpeg"].includes(texture.getMimeType()) || Math.max(...size) <= limit) continue;
    try {
      if (size[0] * size[1] > 67_108_864) throw new Error("Texture exceeds 64 megapixels; kept at original resolution.");
      if (size[0] * size[1] > 16_777_216) await resizeLargeTexture(texture, limit, signal);
      else await compressTexture(texture, { resize: [limit, limit] });
    } catch (error) {
      signal.throwIfAborted();
      warnings.push(`Texture ${texture.getName() || "(unnamed)"} (${size.join("×")}): ${error instanceof Error ? error.message : "Could not resize; kept original."}`);
    }
  }
  signal.throwIfAborted();
  const output = await io.writeBinary(document);
  signal.throwIfAborted();
  const after = statistics(document, output.byteLength);
  if (output.byteLength >= file.size && after.triangles >= before.triangles) {
    report(optimizationReport(before, before, target, warnings, tool.language));
    return [];
  }
  report(optimizationReport(before, after, target, warnings, tool.language));
  return [{ url: URL.createObjectURL(new Blob([output as Uint8Array<ArrayBuffer>], { type: "model/gltf-binary" })), name: "GLB", kind: "file" }];
}
