import assert from "node:assert/strict";
import test from "node:test";
import { Document, WebIO } from "@gltf-transform/core";
import { generate } from "./generation";
import { optimizationReport, processModel } from "./model-tools";
import { PlaneGeometry } from "three";

async function denseFixture() {
  const document = new Document();
  const buffer = document.createBuffer();
  const geometry = new PlaneGeometry(2, 2, 32, 32);
  const primitive = document.createPrimitive().setIndices(document.createAccessor().setType("SCALAR").setArray(new Uint32Array(geometry.index!.array)).setBuffer(buffer));
  for (const [name, attribute, type] of [["POSITION", "position", "VEC3"], ["NORMAL", "normal", "VEC3"], ["TEXCOORD_0", "uv", "VEC2"]] as const) {
    primitive.setAttribute(name, document.createAccessor().setType(type).setArray(new Float32Array(geometry.getAttribute(attribute).array)).setBuffer(buffer));
  }
  const count = geometry.getAttribute("position").count;
  primitive.setAttribute("JOINTS_0", document.createAccessor().setType("VEC4").setArray(new Uint16Array(count * 4)).setBuffer(buffer));
  primitive.setAttribute("WEIGHTS_0", document.createAccessor().setType("VEC4").setArray(Float32Array.from({ length: count * 4 }, (_, i) => i % 4 === 0 ? 1 : 0)).setBuffer(buffer));
  primitive.addTarget(document.createPrimitiveTarget().setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(Float32Array.from({ length: count * 3 }, (_, i) => i % 3 === 2 ? 0.01 : 0)).setBuffer(buffer)));
  const joint = document.createNode("joint");
  const skin = document.createSkin().addJoint(joint).setSkeleton(joint);
  const node = document.createNode("dense").setMesh(document.createMesh("dense").addPrimitive(primitive)).setSkin(skin);
  const small = document.createPrimitive().setAttribute("POSITION", document.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1])).setBuffer(buffer));
  document.createScene().addChild(joint).addChild(node).addChild(document.createNode("small").setMesh(document.createMesh("small").addPrimitive(small)));
  const sampler = document.createAnimationSampler()
    .setInput(document.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buffer))
    .setOutput(document.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 0, 1, 0])).setBuffer(buffer));
  document.createAnimation("move").addSampler(sampler).addChannel(document.createAnimationChannel().setTargetNode(node).setTargetPath("translation").setSampler(sampler));
  geometry.dispose();
  const bytes = await new WebIO().writeBinary(document);
  return new File([bytes as Uint8Array<ArrayBuffer>], "dense.glb");
}

async function fixture(textureSize?: number) {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = document.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute("POSITION", positions);
  if (textureSize) {
    const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64"));
    const view = new DataView(png.buffer);
    view.setUint32(16, textureSize); view.setUint32(20, textureSize);
    primitive.setMaterial(document.createMaterial().setBaseColorTexture(document.createTexture("large").setImage(png).setMimeType("image/png")));
  }
  const node = document.createNode("triangle").setMesh(document.createMesh().addPrimitive(primitive));
  document.createScene().addChild(node).addChild(document.createNode("attachment point"));
  const times = document.createAccessor().setType("SCALAR").setArray(new Float32Array([0, 1])).setBuffer(buffer);
  const translations = document.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0])).setBuffer(buffer);
  const sampler = document.createAnimationSampler().setInput(times).setOutput(translations);
  document.createAnimation("move").addSampler(sampler).addChannel(document.createAnimationChannel().setTargetNode(node).setTargetPath("translation").setSampler(sampler));
  for (let i = 0; i < 30; i++) document.createMaterial(`unused ${i}`);
  const bytes = await new WebIO().writeBinary(document);
  return new File([bytes as Uint8Array<ArrayBuffer>], "triangle.glb", { type: "model/gltf-binary" });
}

test("inspect routes locally without provider calls and reports actual model data", async () => {
  const file = await fixture();
  let summary = "";
  const files = await generate({ id: "inspect", category: "3d", model: "Local media tools", prompt: "inspect", status: "Waiting", mediaTool: { name: "inspect_3d", model_index: 0 } }, async () => { throw new Error("Must not call a provider"); }, new AbortController().signal, change => { summary = change.summary ?? summary; }, undefined, [], [{ file, url: "unused" }]);
  assert.deepEqual(files, []);
  assert.match(summary, /"triangles":1/);
  assert.match(summary, /"animations":1/);
  assert.match(summary, new RegExp(`"bytes":${file.size}`));
});

test("optimization shrinks a GLB while preserving geometry, animations, nodes and original bytes", async () => {
  const file = await fixture();
  const original = new Uint8Array(await file.arrayBuffer());
  let summary = "";
  const result = await processModel({ name: "optimize_3d", model_index: 0 }, file, new AbortController().signal, value => { summary = value; });
  assert.equal(result.length, 1);
  try {
    const bytes = new Uint8Array(await (await fetch(result[0].url)).arrayBuffer());
    assert.ok(bytes.length < file.size);
    const root = (await new WebIO().readBinary(bytes)).getRoot();
    assert.equal(root.listAnimations().length, 1);
    assert.ok(root.listNodes().some(n => n.getName() === "attachment point"));
    assert.deepEqual(Array.from(root.listMeshes()[0].listPrimitives()[0].getAttribute("POSITION")!.getArray()!), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), original);
    assert.match(summary, /smaller/);
    const second = new File([bytes], "optimized.glb");
    const unchanged = await processModel({ name: "optimize_3d", model_index: 0 }, second, new AbortController().signal, value => { summary = value; });
    assert.deepEqual(unchanged, []);
    assert.match(summary, /No further reduction/);
  } finally { URL.revokeObjectURL(result[0].url); }
});

test("rejects malformed GLBs and cancellation", async () => {
  const file = await fixture();
  await assert.rejects(processModel({ name: "inspect_3d", model_index: 0 }, file, AbortSignal.abort(), () => {}));
  await assert.rejects(processModel({ name: "optimize_3d", model_index: 0 }, new File(["invalid"], "bad.glb"), new AbortController().signal, () => {}));
});

test("oversized or undecodable textures stay intact while other optimization continues", async () => {
  for (const size of [8192, 16384]) {
    const file = await fixture(size);
    let summary = "";
    const files = await processModel({ name: "optimize_3d", model_index: 0 }, file, new AbortController().signal, value => { summary = value; });
    assert.equal(files.length, 1, summary);
    try {
      const bytes = new Uint8Array(await (await fetch(files[0].url)).arrayBuffer());
      const root = (await new WebIO().readBinary(bytes)).getRoot();
      assert.deepEqual(root.listTextures()[0].getSize(), [size, size]);
      assert.match(summary, /Warnings:/);
      if (size === 16384) assert.match(summary, /exceeds 64 megapixels/);
    } finally { URL.revokeObjectURL(files[0].url); }
  }
});

test("polygon reduction honors budgets, compacts UV/skin/morph data and preserves animation and small parts", async () => {
  const file = await denseFixture();
  const original = new Uint8Array(await file.arrayBuffer());
  for (const target_triangles of [undefined, 256, 4, 0]) {
    let summary = "";
    const files = await processModel({ name: "optimize_3d", model_index: 0, target_triangles }, file, new AbortController().signal, value => { summary = value; });
    if (target_triangles === 0) { assert.deepEqual(files, []); assert.match(summary, /No further reduction/); continue; }
    assert.equal(files.length, 1, `${target_triangles}: ${summary}`);
    try {
      const root = (await new WebIO().readBinary(new Uint8Array(await (await fetch(files[0].url)).arrayBuffer()))).getRoot();
      const dense = root.listMeshes().find(mesh => mesh.getName() === "dense")!.listPrimitives()[0];
      const triangles = dense.getIndices()!.getCount() / 3 + 1;
      if (target_triangles === 4) { assert.ok(triangles > 4 && triangles < 2049); assert.match(summary, /target 4 not reached/); }
      else { assert.ok(triangles > 0 && triangles <= (target_triangles ?? 1024)); assert.match(summary, /\| Triangles \| 2,049 \|/); }
      const vertices = dense.getAttribute("POSITION")!.getCount();
      for (const name of ["NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"]) assert.equal(dense.getAttribute(name)!.getCount(), vertices);
      assert.equal(dense.listTargets()[0].getAttribute("POSITION")!.getCount(), vertices);
      assert.ok(Array.from(dense.getIndices()!.getArray()!).every(index => index < vertices));
      assert.equal(root.listAnimations().length, 1);
      assert.equal(root.listNodes().find(node => node.getName() === "dense")!.getSkin()!.listJoints().length, 1);
      assert.equal(root.listMeshes().find(mesh => mesh.getName() === "small")!.listPrimitives()[0].getAttribute("POSITION")!.getCount(), 3);
    } finally { URL.revokeObjectURL(files[0].url); }
  }
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), original);
});

test("optimization reports readable localized numbers and actual results without raw JSON", () => {
  const before = { bytes: 47810032, triangles: 2000000, vertices: 1025035, meshes: 1, materials: 1, skins: 0, animations: 0, textures: [0, 1].map(() => ({ name: "", dimensions: [8192, 8192] as [number, number], bytes: 100 })) };
  const after = { ...before, bytes: 23135964, triangles: 1000000, vertices: 521676, textures: before.textures.map(t => ({ ...t, dimensions: [2048, 2048] as [number, number] })) };
  const thai = optimizationReport(before, after, 1000000, [], "th");
  assert.match(thai, /ปรับโมเดล 3D เรียบร้อยแล้ว/);
  assert.match(thai, /51\.6%/);
  assert.match(thai, /50\.0%/);
  assert.match(thai, /47\.8 MB \| 23\.1 MB/);
  assert.match(thai, /2,000,000 \| 1,000,000/);
  assert.match(thai, /8,?192 × 8,?192 px \(2\)/);
  assert.match(thai, /ลดถึงเป้าหมาย 1,000,000/);
  assert.ok(!thai.includes('"bytes"') && !thai.includes("{"));
  const missed = optimizationReport(before, after, 100000, ["Target not reached"], "en");
  assert.ok(!missed.includes("Reached the target"));
  assert.match(missed, /Warnings:[\s\S]*Target not reached/);
  const larger = optimizationReport(before, { ...after, bytes: before.bytes * 1.1 }, 1000000, []);
  assert.match(larger, /10\.0% larger/);
  const unchanged = optimizationReport(before, before, 0, [], "th");
  assert.match(unchanged, /ไม่ได้สร้างไฟล์ใหม่/);
  assert.ok(!unchanged.includes("ลดถึงเป้าหมาย"));
});
