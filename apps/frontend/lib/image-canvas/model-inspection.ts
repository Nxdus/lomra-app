import { Bone, Mesh, SkinnedMesh, Texture, type Object3D } from "three";

export function inspectModel(root: Object3D) {
  const bones: Bone[] = [], meshes: Mesh[] = [];
  const materials = new Set(), textures = new Set<Texture>();
  let triangles = 0;
  root.traverse((node) => {
    if (node instanceof Bone) bones.push(node);
    if (!(node instanceof Mesh)) return;
    meshes.push(node);
    triangles += Math.floor((node.geometry.index?.count ?? node.geometry.getAttribute("position")?.count ?? 0) / 3);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  const bindings = new Map<Bone, { name: string; vertices: number }[]>();
  meshes.forEach((mesh, meshIndex) => {
    if (!(mesh instanceof SkinnedMesh)) return;
    const counts = new Uint32Array(mesh.skeleton.bones.length);
    const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
    if (indices && weights) for (let i = 0; i < indices.count; i++) {
      const counted: number[] = [];
      for (let j = 0; j < Math.min(indices.itemSize, weights.itemSize); j++) {
        const joint = indices.getComponent(i, j);
        if (weights.getComponent(i, j) > 0 && joint < counts.length && !counted.includes(joint)) { counts[joint]++; counted.push(joint); }
      }
    }
    mesh.skeleton.bones.forEach((bone, joint) => {
      const entries = bindings.get(bone) ?? [];
      entries.push({ name: mesh.name || `Mesh ${meshIndex + 1}`, vertices: counts[joint] });
      bindings.set(bone, entries);
    });
  });
  const rig = bones.map((bone) => {
    let parent = bone.parent;
    while (parent && !(parent instanceof Bone)) parent = parent.parent;
    return { id: bone.uuid, name: bone.name || "Unnamed bone", parent: parent?.uuid ?? null, influences: bindings.get(bone) ?? [] };
  });
  return { meshes: meshes.length, triangles, materials: materials.size, textures: textures.size, skinnedMeshes: meshes.filter(mesh => mesh instanceof SkinnedMesh).length, rig };
}
