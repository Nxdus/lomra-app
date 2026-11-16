import { AnimationClip, AnimationMixer, Bone, Object3D, Quaternion, QuaternionKeyframeTrack, SkinnedMesh, Vector3, VectorKeyframeTrack, type KeyframeTrack } from "three";
import type { GeneratedFile } from "./generation";

const aliases: Record<string, string[]> = {
  hips: ["hips", "pelvis"], spine: ["spine", "spine1"], chest: ["spine2", "chest"], upperChest: ["spine3", "upperchest"], neck: ["neck"], head: ["head"],
  leftThigh: ["leftupleg", "leftupperleg", "leftthigh", "lhip"], leftShin: ["leftleg", "leftlowerleg", "leftcalf", "lknee"], leftFoot: ["leftfoot", "lankle"], leftToe: ["lefttoebase", "lfoot"],
  rightThigh: ["rightupleg", "rightupperleg", "rightthigh", "rhip"], rightShin: ["rightleg", "rightlowerleg", "rightcalf", "rknee"], rightFoot: ["rightfoot", "rankle"], rightToe: ["righttoebase", "rfoot"],
  leftShoulder: ["leftshoulder", "lcollar"], leftArm: ["leftarm", "leftupperarm", "lshoulder"], leftForearm: ["leftforearm", "leftlowerarm", "lelbow"], leftHand: ["lefthand", "lwrist"],
  rightShoulder: ["rightshoulder", "rcollar"], rightArm: ["rightarm", "rightupperarm", "rshoulder"], rightForearm: ["rightforearm", "rightlowerarm", "relbow"], rightHand: ["righthand", "rwrist"],
};

function joints(root: Object3D) {
  const named = new Map<string, Bone>();
  root.traverse(node => {
    if (node instanceof SkinnedMesh) node.skeleton.pose();
    if (node instanceof Bone) {
      const name = node.name.toLowerCase().replace(/^mixamorig\d*[:_]?/, "").replace(/[^a-z0-9]/g, "");
      if (!named.has(name)) named.set(name, node);
    }
  });
  root.updateMatrixWorld(true);
  return Object.fromEntries(Object.entries(aliases).flatMap(([joint, names]) => {
    if (named.has("spine")) {
      if (joint === "chest") names = ["spine1", "chest"];
      if (joint === "upperChest") names = ["spine2", "upperchest"];
    }
    const bone = names.map(name => named.get(name)).find(Boolean);
    return bone ? [[joint, bone]] : [];
  })) as Record<string, Bone>;
}

export function fitMotionClip(target: Object3D, source: Object3D, motion: AnimationClip): AnimationClip {
  if (!Number.isFinite(motion.duration) || motion.duration <= 0 || motion.duration > 12 || !motion.tracks.length) throw new Error("Invalid motion clip.");
  const to = joints(target), from = joints(source);
  const required = ["hips", "spine", "leftThigh", "leftShin", "leftFoot", "rightThigh", "rightShin", "rightFoot", "leftArm", "leftForearm", "rightArm", "rightForearm"];
  if (required.some(name => !to[name] || !from[name])) throw new Error("This skeleton cannot be fitted automatically. Expected a Meshy/Mixamo biped rig; original model preserved.");
  const legLength = (bones: Record<string, Bone>) => bones.leftThigh.getWorldPosition(new Vector3()).distanceTo(bones.leftShin.getWorldPosition(new Vector3())) + bones.leftShin.getWorldPosition(new Vector3()).distanceTo(bones.leftFoot.getWorldPosition(new Vector3()));
  const scale = legLength(to) / legLength(from);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("The rig has invalid leg proportions.");
  const pairs = Object.entries(to).filter(([name]) => from[name]).map(([name, bone]) => ({
    bone, source: from[name], rest: bone.getWorldQuaternion(new Quaternion()), inverseSourceRest: from[name].getWorldQuaternion(new Quaternion()).invert(), values: [] as number[],
  }));
  // Process parents before their children when converting world rotations to local rotations.
  const depth = (bone: Object3D): number => bone.parent ? depth(bone.parent) + 1 : 0;
  pairs.sort((a, b) => depth(a.bone) - depth(b.bone));
  const restPosition = to.hips.getWorldPosition(new Vector3());
  const transforms: { bone: Object3D; position: Vector3; quaternion: Quaternion; scale: Vector3 }[] = [];
  target.traverse(bone => transforms.push({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
  const mixer = new AnimationMixer(source);
  mixer.clipAction(motion).play();
  const times: number[] = [], positions: number[] = [];
  let firstPosition: Vector3 | undefined;
  try {
    const frames = Math.ceil(motion.duration * 30);
    for (let frame = 0; frame <= frames; frame++) {
      const time = Math.min(frame / 30, motion.duration - 0.000001);
      mixer.setTime(time);
      source.updateMatrixWorld(true);
      const position = from.hips.getWorldPosition(new Vector3());
      firstPosition ??= position.clone();
      position.sub(firstPosition).multiplyScalar(scale).add(restPosition);
      to.hips.parent?.worldToLocal(position);
      to.hips.position.copy(position);
      positions.push(...position.toArray());
      times.push(time);
      for (const pair of pairs) {
        const rotation = pair.source.getWorldQuaternion(new Quaternion()).multiply(pair.inverseSourceRest).multiply(pair.rest);
        if (pair.bone.parent) rotation.premultiply(pair.bone.parent.getWorldQuaternion(new Quaternion()).invert());
        pair.bone.quaternion.copy(rotation);
        pair.bone.updateMatrixWorld(true);
        pair.values.push(...rotation.toArray());
      }
    }
    const tracks: KeyframeTrack[] = pairs.map(pair => new QuaternionKeyframeTrack(`${pair.bone.uuid}.quaternion`, times, pair.values));
    tracks.push(new VectorKeyframeTrack(`${to.hips.uuid}.position`, times, positions));
    return new AnimationClip("Custom motion", -1, tracks);
  } finally {
    mixer.stopAllAction(); mixer.uncacheRoot(source);
    for (const item of transforms) { item.bone.position.copy(item.position); item.bone.quaternion.copy(item.quaternion); item.bone.scale.copy(item.scale); }
    target.updateMatrixWorld(true);
  }
}

export async function fitMotion(rigUrl: string, motionUrl: string, signal: AbortSignal): Promise<GeneratedFile[]> {
  const [{ GLTFLoader }, { FBXLoader }, { GLTFExporter }, { MeshoptDecoder }, THREE] = await Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"), import("three/examples/jsm/loaders/FBXLoader.js"), import("three/examples/jsm/exporters/GLTFExporter.js"), import("meshoptimizer"), import("three"),
  ]);
  const read = async (url: string) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("Could not download the rig or motion. Check job to retry the download.");
    return response.arrayBuffer();
  };
  const [rigBytes, motionBytes] = await Promise.all([read(rigUrl), read(motionUrl)]);
  signal.throwIfAborted();
  const rig = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(rigBytes, "");
  let source: Object3D | undefined;
  try {
    // Only motion is needed from the source FBX, not its mannequin textures.
    const manager = new THREE.LoadingManager();
    const textures = new THREE.TextureLoader();
    textures.load = (url: string) => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); return new THREE.Texture(); };
    manager.addHandler(/.*/, textures);
    source = new FBXLoader(manager).parse(motionBytes, "");
    if (!source.animations[0]) throw new Error("The FBX contains no motion clip.");
    const clip = fitMotionClip(rig.scene, source, source.animations[0]);
    signal.throwIfAborted();
    const bytes = await new GLTFExporter().parseAsync(rig.scene, { binary: true, animations: [clip] }) as ArrayBuffer;
    signal.throwIfAborted();
    return [{ url: URL.createObjectURL(new Blob([bytes], { type: "model/gltf-binary" })), name: "GLB", kind: "file" }];
  } finally {
    for (const root of [rig.scene, source]) root?.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
  }
}
