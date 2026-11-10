import { LoadingManager, Material, Mesh, MeshPhongMaterial, MeshStandardMaterial, Texture } from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { GeneratedFile } from "./generation";

export async function objToGlb(blob: Blob, files: GeneratedFile[]): Promise<File> {
  if (blob.size > 50 * 1024 * 1024) throw new Error("OBJ file exceeds 50 MB.");
  const loader = new OBJLoader();
  const textures = new Set<Texture>();
  const materials = new Set<Material>();
  const model = loader.parse(await blob.text());
  try {
    const mtl = files.find((file) => file.name === "MTL");
    if (mtl) {
      const response = await fetch(mtl.url, { credentials: "omit", signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error("Could not download the model materials.");
      const text = await response.text();
      if (text.length > 1024 * 1024) throw new Error("Model materials exceed 1 MB.");
      const manager = new LoadingManager();
      const texture = files.find((file) => file.name === "TEXTURE");
      // Rapid hosts its diffuse texture separately from the filename in the MTL.
      const source = texture ? text.replace(/^\s*map_Kd\s+.*$/gim, `map_Kd ${texture.url}`) : text;
      manager.setURLModifier((url) => {
        if (!files.some((file) => file.url === url)) throw new Error("Model references a texture missing from the result files.");
        return url;
      });
      const creator = new MTLLoader(manager).parse(source, new URL(".", mtl.url).href);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Model texture loading timed out.")), 60_000);
          manager.onLoad = resolve;
          manager.onError = () => reject(new Error("Could not load the model texture."));
          manager.itemStart("materials");
          model.traverse((object) => {
            if (!(object instanceof Mesh)) return;
            const original = Array.isArray(object.material) ? object.material : [object.material];
            const converted = original.map((material) => {
              materials.add(material);
              const source = creator.create(material.name);
              materials.add(source);
              if (!(source instanceof MeshPhongMaterial)) throw new Error("Unsupported OBJ material.");
              for (const value of Object.values(source)) if (value instanceof Texture) textures.add(value);
              const result = new MeshStandardMaterial({ color: source.color, map: source.map, normalMap: source.normalMap, emissive: source.emissive, emissiveMap: source.emissiveMap, transparent: source.transparent, opacity: source.opacity, side: source.side });
              materials.add(result);
              return result;
            });
            object.material = Array.isArray(object.material) ? converted : converted[0];
          });
          manager.itemEnd("materials");
        });
      } finally { clearTimeout(timer); }
    }
    if (!model.children.length) throw new Error("The OBJ file contains no model geometry.");
    const result = await new GLTFExporter().parseAsync(model, { binary: true });
    if (!(result instanceof ArrayBuffer)) throw new Error("Could not convert the model to GLB.");
    return new File([result], "Model.glb", { type: "model/gltf-binary" });
  } finally {
    model.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    });
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }
}
