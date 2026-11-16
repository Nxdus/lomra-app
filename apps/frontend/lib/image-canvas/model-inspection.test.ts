import assert from "node:assert/strict";
import test from "node:test";
import { Bone, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Skeleton, SkinnedMesh, Texture, Uint16BufferAttribute } from "three";
import { inspectModel } from "./model-inspection";

test("reports hierarchy and counts each vertex once per bone, ignoring zero weights", () => {
  const root = new Group(), hip = new Bone(), hand = new Bone();
  hip.name = "Hip"; hand.name = "Hand"; hip.add(hand); root.add(hip);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute([0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0], 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute([0.5, 0.5, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0], 4));
  const texture = new Texture(), material = new MeshBasicMaterial({ map: texture });
  const mesh = new SkinnedMesh(geometry, material); mesh.name = "Body"; root.add(mesh); mesh.bind(new Skeleton([hip, hand]));
  const info = inspectModel(root);
  assert.deepEqual([info.meshes, info.triangles, info.materials, info.textures, info.skinnedMeshes], [1, 1, 1, 1, 1]);
  assert.equal(info.rig[1].parent, hip.uuid);
  assert.deepEqual(info.rig.map(bone => bone.influences), [[{ name: "Body", vertices: 2 }], [{ name: "Body", vertices: 2 }]]);
});

test("handles static meshes and shared materials without inventing a rig", () => {
  const root = new Group(), material = new MeshBasicMaterial();
  root.add(new Mesh(new BufferGeometry(), material), new Mesh(new BufferGeometry(), material));
  const info = inspectModel(root);
  assert.equal(info.materials, 1); assert.equal(info.skinnedMeshes, 0); assert.deepEqual(info.rig, []);
});
