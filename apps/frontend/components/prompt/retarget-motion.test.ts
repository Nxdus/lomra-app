import assert from "node:assert/strict";
import test from "node:test";
import { AnimationClip, AnimationMixer, Bone, Group, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack } from "three";
import { fitMotionClip } from "./retarget-motion";

function biped(short = false) {
  const root = new Group();
  const bones: Record<string, Bone> = {};
  const add = (name: string, parent: string | null, y: number) => {
    const bone = new Bone(); bone.name = name; bone.position.y = y;
    (parent ? bones[parent] : root).add(bone); bones[name] = bone;
  };
  add("Hips", null, short ? 0.5 : 1);
  add("Spine", "Hips", 0.2);
  for (const side of ["Left", "Right"]) {
    add(`${side}UpLeg`, "Hips", 0);
    add(`${side}Leg`, `${side}UpLeg`, short ? -0.25 : -0.5);
    add(`${side}Foot`, `${side}Leg`, short ? -0.25 : -0.5);
    add(`${side}Arm`, "Spine", 0.1);
    add(`${side}ForeArm`, `${side}Arm`, 0.2);
  }
  root.updateMatrixWorld(true);
  return { root, bones };
}

test("retargeting preserves target proportions and rest pose, scales root movement and transfers joint rotations", () => {
  const source = biped(), target = biped(true);
  const rest = target.bones.LeftArm.quaternion.clone().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.3);
  target.bones.LeftArm.quaternion.copy(rest);
  const q = new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.5);
  const clip = new AnimationClip("walk", 1, [new VectorKeyframeTrack("Hips.position", [0, 1], [0, 1, 0, 0, 1, 2]), new QuaternionKeyframeTrack("LeftArm.quaternion", [0, 1], [0, 0, 0, 1, ...q.toArray()])]);
  const result = fitMotionClip(target.root, source.root, clip);
  assert.ok(target.bones.LeftArm.quaternion.equals(rest));
  assert.equal(target.bones.LeftLeg.position.y, -0.25);
  const position = result.tracks.find(track => track.name.endsWith(".position"))!;
  assert.ok(Math.abs(position.values.at(-1)! - 1) < 0.001);
  assert.ok(Math.abs(position.values[1] - 0.5) < 0.001);
  assert.ok(result.tracks.every(track => Array.from(track.values).every(Number.isFinite)));
  const mixer = new AnimationMixer(target.root); mixer.clipAction(result).play(); mixer.setTime(0.5);
  assert.ok(target.bones.LeftArm.quaternion.angleTo(rest) > 0.1);
  assert.equal(target.bones.LeftLeg.position.y, -0.25);
});

test("unsupported skeletons fail instead of silently returning a broken character", () => {
  assert.throws(() => fitMotionClip(new Group(), biped().root, new AnimationClip("motion", 1, [new VectorKeyframeTrack("Hips.position", [0, 1], [0, 0, 0, 0, 0, 1])])), /skeleton cannot be fitted/);
});
