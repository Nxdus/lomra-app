"use client";

import { useEffect, useRef, useState } from "react";
import type { AnimationAction } from "three";
import { BoneIcon, DownloadIcon, InfoIcon, PauseIcon, PlayIcon, RotateCcwIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { inspectModel } from "@/lib/image-canvas/model-inspection";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";

type Inspection = ReturnType<typeof inspectModel>;
type Controls = { reset: () => void; selectBone: (id: string) => void; skeleton: (show: boolean) => void; animation: (index: number) => void; playback: (playing: boolean, speed: number) => void; lighting: (render: boolean, exposure: number, intensity: number, angle: number, background: string) => void; capture: () => Promise<Blob> };

export function ModelInspector({ src, file }: { src: string; file: File }) {
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef<Controls | null>(null);
  const [info, setInfo] = useState<Inspection | null>(null);
  const [error, setError] = useState("");
  const [skeleton, setSkeleton] = useState(false);
  const [boneId, setBoneId] = useState("");
  const [clips, setClips] = useState<{ name: string; duration: number }[]>([]);
  const [clip, setClip] = useState("0");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [background, setBackground] = useState("light");
  const [mode, setMode] = useState("material");
  const [exposure, setExposure] = useState(1);
  const [intensity, setIntensity] = useState(3);
  const [angle, setAngle] = useState(45);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    const container = host.current!;
    (async () => {
      const [T, { GLTFLoader }, { OrbitControls }, { MeshoptDecoder }, { RoomEnvironment }] = await Promise.all([
        import("three"), import("three/addons/loaders/GLTFLoader.js"), import("three/addons/controls/OrbitControls.js"), import("meshoptimizer"), import("three/addons/environments/RoomEnvironment.js"),
      ]);
      if (cancelled) return;
      const scene = new T.Scene();
      const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.domElement.className = "size-full";
      renderer.domElement.setAttribute("aria-label", "Interactive model preview");
      container.append(renderer.domElement);
      const camera = new T.PerspectiveCamera(45, 1, 0.01, 1000);
      const orbit = new OrbitControls(camera, renderer.domElement);
      orbit.enableDamping = true;
      const pmrem = new T.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const environment = pmrem.fromScene(room);
      scene.environment = environment.texture;
      room.dispose(); pmrem.dispose();
      const fill = new T.HemisphereLight(0xffffff, 0x888888, 2);
      scene.add(fill);
      const light = new T.DirectionalLight(0xffffff, 3);
      light.position.set(3, 5, 4); scene.add(light);
      scene.add(light.target);
      light.shadow.mapSize.set(2048, 2048);
      renderer.shadowMap.type = T.PCFShadowMap;
      const floor = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShadowMaterial({ opacity: 0.3 }));
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.visible = false;
      scene.add(floor);
      const loaded: { mixer?: InstanceType<typeof T.AnimationMixer>; model?: InstanceType<typeof T.Group>; helper?: InstanceType<typeof T.SkeletonHelper> } = {};
      let action: AnimationAction | undefined;
      let selected: InstanceType<typeof T.Bone> | undefined;
      const marker = new T.Mesh(new T.SphereGeometry(1, 12, 8), new T.MeshBasicMaterial({ color: 0xffa500, depthTest: false, depthWrite: false }));
      marker.visible = false; marker.renderOrder = 2; scene.add(marker);
      const disposeModel = (root: InstanceType<typeof T.Object3D>) => {
        const textures = new Set<InstanceType<typeof T.Texture>>();
        const skeletons = new Set<InstanceType<typeof T.Skeleton>>();
        root.traverse(node => {
          if (!(node instanceof T.Mesh)) return;
          node.geometry.dispose();
          if (node instanceof T.SkinnedMesh) skeletons.add(node.skeleton);
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value);
            material.dispose();
          }
        });
        textures.forEach(texture => { texture.dispose(); if (typeof ImageBitmap !== "undefined" && texture.source.data instanceof ImageBitmap) texture.source.data.close(); });
        skeletons.forEach(skeleton => skeleton.dispose());
      };
      const observer = new ResizeObserver(() => {
        const width = container.clientWidth, height = container.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
      });
      observer.observe(container);
      let previous = performance.now();
      renderer.setAnimationLoop((now) => {
        const delta = Math.min((now - previous) / 1000, 0.1); previous = now;
        loaded.mixer?.update(delta);
        loaded.model?.updateMatrixWorld(true);
        if (selected) selected.getWorldPosition(marker.position);
        orbit.update(); renderer.render(scene, camera);
      });
      let disposed = false;
      cleanup = () => {
        if (disposed) return;
        disposed = true;
        controls.current = null; observer.disconnect(); renderer.setAnimationLoop(null);
        loaded.mixer?.stopAllAction(); if (loaded.model) { loaded.mixer?.uncacheRoot(loaded.model); disposeModel(loaded.model); }
        loaded.helper?.dispose(); marker.geometry.dispose(); marker.material.dispose();
        floor.geometry.dispose(); floor.material.dispose(); light.shadow.dispose();
        orbit.dispose(); environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      };
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(src);
      if (cancelled) { disposeModel(gltf.scene); return; }
      const model = gltf.scene;
      loaded.model = model;
      scene.add(model);
      model.updateMatrixWorld(true);
      const bounds = new T.Box3().setFromObject(model);
      if (bounds.isEmpty()) throw new Error("This model has no visible geometry.");
      const center = bounds.getCenter(new T.Vector3());
      const radius = Math.max(bounds.getSize(new T.Vector3()).length() / 2, 0.001);
      floor.position.set(center.x, bounds.min.y - radius * 0.002, center.z);
      floor.scale.setScalar(radius * 20);
      light.target.position.copy(center);
      Object.assign(light.shadow.camera, { left: -radius * 2, right: radius * 2, top: radius * 2, bottom: -radius * 2, near: radius * 0.01, far: radius * 12 });
      light.shadow.camera.updateProjectionMatrix();
      light.shadow.normalBias = radius * 0.002;
      model.traverse(node => { if (node instanceof T.Mesh) { node.castShadow = true; node.receiveShadow = true; } });
      marker.scale.setScalar(radius * 0.025);
      const reset = () => {
        const halfFov = Math.atan(Math.tan(T.MathUtils.degToRad(22.5)) * Math.min(camera.aspect, 1));
        const distance = radius / Math.sin(halfFov) * 1.15;
        camera.near = radius / 1000; camera.far = Math.max(radius * 100, distance * 2);
        camera.position.copy(center).add(new T.Vector3(0, radius * 0.15, distance));
        camera.updateProjectionMatrix(); orbit.target.copy(center); orbit.update();
      };
      reset();
      const helper = new T.SkeletonHelper(model); helper.visible = false; helper.renderOrder = 1; scene.add(helper);
      loaded.helper = helper;
      const mixer = new T.AnimationMixer(model);
      loaded.mixer = mixer;
      controls.current = {
        reset,
        skeleton: show => { if (helper) helper.visible = show; },
        selectBone: id => { selected = model?.getObjectByProperty("uuid", id) as InstanceType<typeof T.Bone> | undefined; marker.visible = !!selected; },
        animation: index => { mixer!.stopAllAction(); action = mixer!.clipAction(gltf.animations[index]); action.reset().play(); },
        playback: (play, rate) => { if (action) { action.paused = !play; action.timeScale = rate; } },
        lighting: (render, exposure, intensity, angle, background) => {
          if (renderer.shadowMap.enabled !== render) model.traverse(node => {
            if (node instanceof T.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.needsUpdate = true;
          });
          renderer.shadowMap.enabled = render; light.castShadow = render; floor.visible = render;
          renderer.toneMappingExposure = render ? exposure : 1;
          fill.intensity = render ? 0.35 : 2; scene.environmentIntensity = render ? 0.45 : 1;
          light.intensity = render ? intensity : 3;
          const radians = T.MathUtils.degToRad(angle);
          if (render) light.position.copy(center).add(new T.Vector3(Math.sin(radians) * radius * 4, radius * 5, Math.cos(radians) * radius * 4));
          else light.position.set(3, 5, 4);
          scene.background = new T.Color(background === "dark" ? "#171717" : background === "gray" ? "#808080" : "#ffffff");
        },
        capture: async () => {
          const size = renderer.getSize(new T.Vector2()), pixelRatio = renderer.getPixelRatio();
          const showHelper = helper.visible, showMarker = marker.visible;
          try {
            helper.visible = false; marker.visible = false;
            const scale = 2048 / Math.max(size.x, size.y);
            renderer.setPixelRatio(1); renderer.setSize(Math.round(size.x * scale), Math.round(size.y * scale), false);
            renderer.render(scene, camera);
            return new Promise<Blob>((resolve, reject) => {
              renderer.domElement.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not encode PNG.")), "image/png");
            });
          } finally {
            renderer.setPixelRatio(pixelRatio); renderer.setSize(size.x, size.y, false);
            helper.visible = showHelper; marker.visible = showMarker;
          }
        },
      };
      setInfo(inspectModel(model));
      setClips(gltf.animations.map((animation, i) => ({ name: animation.name || `Animation ${i + 1}`, duration: animation.duration })));
    })().catch(reason => {
      cleanup();
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not inspect this model.");
    });
    return () => { cancelled = true; cleanup(); };
  }, [src]);

  useEffect(() => { if (clips.length) controls.current?.animation(Number(clip)); }, [clip, clips]);
  useEffect(() => { controls.current?.playback(playing, Number(speed)); }, [playing, speed, clip, clips]);
  useEffect(() => { controls.current?.lighting(mode === "render", exposure, intensity, angle, background); }, [mode, exposure, intensity, angle, background, info]);

  async function saveRender() {
    if (!controls.current || saving) return;
    setSaving(true);
    try {
      const blob = await controls.current.capture();
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `${file.name.replace(/\.glb$/i, "")}-render.png`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (reason) {
      toast.add({ title: "Could not save render", description: reason instanceof Error ? reason.message : "Please retry.", type: "error" });
    } finally { setSaving(false); }
  }
  const bone = info?.rig.find(bone => bone.id === boneId);
  const depth = (id: string): number => { const parent = info?.rig.find(bone => bone.id === id)?.parent; return parent ? 1 + depth(parent) : 0; };

  const fileSize = file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : `${(file.size / 1024).toFixed(1)} KB`;

  return <div className="flex min-w-0 flex-col gap-3">
    <div className="relative overflow-hidden rounded-2xl">
      <div ref={host} className="h-[58vh] min-h-64 sm:h-[62vh]" style={{ background: background === "dark" ? "#171717" : background === "gray" ? "#808080" : "#ffffff" }} />
      {!info && !error && <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Loading model…</p>}
    </div>
    {error && <Alert variant="destructive"><AlertTitle>Could not inspect model</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap items-center justify-center gap-2">
      <div role="toolbar" aria-label="Model inspection tools" className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-3xl border bg-popover p-1.5 shadow-sm">
        <Button variant="ghost" size="icon-sm" aria-label="Reset view" title="Reset view" disabled={!info} onClick={() => controls.current?.reset()}><RotateCcwIcon /></Button>
        <Popover>
          <PopoverTrigger render={<Button variant={mode === "render" ? "secondary" : "ghost"} size="icon-sm" aria-label="Render settings" title="Render settings" disabled={!info} />}><SunIcon /></PopoverTrigger>
          <PopoverContent side="top" className="w-72 gap-4">
            <PopoverTitle>Shading</PopoverTitle>
            <ToggleGroup value={[mode]} onValueChange={value => { if (value[0]) setMode(String(value[0])); }} size="sm" variant="outline" spacing={0} aria-label="Shading mode">
              <ToggleGroupItem value="material">Material</ToggleGroupItem><ToggleGroupItem value="render">Render</ToggleGroupItem>
            </ToggleGroup>
            {mode === "render" && <>
              {[{ label: "Exposure", value: exposure, min: 0.25, max: 2, step: 0.05, change: setExposure }, { label: "Light intensity", value: intensity, min: 0, max: 8, step: 0.1, change: setIntensity }, { label: "Light direction", value: angle, min: 0, max: 360, step: 5, change: setAngle }].map(setting => <div key={setting.label} className="flex flex-col gap-2"><div className="flex justify-between text-xs"><span>{setting.label}</span><span className="text-muted-foreground tabular-nums">{Number(setting.value.toFixed(2))}</span></div><Slider aria-label={setting.label} min={setting.min} max={setting.max} step={setting.step} value={[setting.value]} onValueChange={value => setting.change(Array.isArray(value) ? value[0] : value)} /></div>)}
              <p className="text-xs text-muted-foreground">Studio lighting with ground shadows.</p>
            </>}
          </PopoverContent>
        </Popover>
        <Toggle size="sm" aria-label="Show skeleton" title="Show skeleton" pressed={skeleton} disabled={!info?.rig.length} onPressedChange={show => { setSkeleton(show); controls.current?.skeleton(show); }}><BoneIcon /></Toggle>
        <ToggleGroup value={[background]} onValueChange={value => { if (value[0]) setBackground(String(value[0])); }} size="sm" spacing={0} aria-label="Preview background">
          {[{ value: "light", color: "#ffffff" }, { value: "gray", color: "#808080" }, { value: "dark", color: "#171717" }].map(({ value, color }) => <ToggleGroupItem key={value} value={value} aria-label={`${value} background`} title={`${value} background`}><span className="size-3.5 rounded-full border border-black/15" style={{ background: color }} /></ToggleGroupItem>)}
        </ToggleGroup>
        <Popover>
          <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Model details" title="Model details" disabled={!info} />}><InfoIcon /></PopoverTrigger>
          <PopoverContent side="top" align="center" className="max-h-[65vh] w-80 max-w-[calc(100vw-3rem)] gap-4 overflow-y-auto">
            <PopoverTitle>Model details</PopoverTitle>
            {info && <>
              <dl className="flex flex-col gap-2 text-sm">{Object.entries({ "File size": fileSize, Meshes: info.meshes, Triangles: info.triangles.toLocaleString(), Materials: info.materials, Textures: info.textures, Bones: info.rig.length, "Skinned meshes": info.skinnedMeshes, Animations: clips.length }).map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{value}</dd></div>)}</dl>
              <section className="flex min-h-0 flex-col gap-2"><h3 className="text-sm font-medium">Rig</h3>
                {!info.rig.length ? <p className="text-sm text-muted-foreground">No rig in this model.</p> : <div className="flex max-h-48 flex-col gap-1 overflow-auto">{info.rig.map(bone => <Button key={bone.id} variant={bone.id === boneId ? "secondary" : "ghost"} size="sm" className="shrink-0 justify-start" style={{ paddingLeft: 8 + depth(bone.id) * 12 }} aria-pressed={bone.id === boneId} onClick={() => { setBoneId(bone.id); controls.current?.selectBone(bone.id); }}><BoneIcon /><span className="truncate">{bone.name}</span></Button>)}</div>}
              </section>
              {bone && <section className="flex flex-col gap-2 text-sm"><h3 className="break-all font-medium">{bone.name}</h3><p className="text-xs text-muted-foreground">Highlighted in orange on the model.</p>{bone.influences.length ? <ul className="flex flex-col gap-1">{bone.influences.map((mesh, i) => <li key={i} className="break-words">{mesh.name}<span className="text-muted-foreground"> · {mesh.vertices.toLocaleString()} weighted vertices</span></li>)}</ul> : <p className="text-muted-foreground">No skinned mesh uses this bone.</p>}</section>}
            </>}
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="icon-sm" aria-label="Save PNG" title="Save PNG · 2048 px" disabled={!info || saving} onClick={() => void saveRender()}><DownloadIcon /></Button>
      </div>
      {!!clips.length && <div className="flex max-w-full items-center gap-1 rounded-3xl border bg-popover p-1.5 shadow-sm">
        <Button variant="ghost" size="icon-sm" aria-label={playing ? "Pause animation" : "Play animation"} title={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)}>{playing ? <PauseIcon /> : <PlayIcon />}</Button>
        <Select value={clip} onValueChange={value => { if (value) setClip(value); }}><SelectTrigger size="sm" className="min-w-0 max-w-40" aria-label="Animation clip"><SelectValue className="min-w-0" title={clips[Number(clip)]?.name}><span className="truncate">{clips[Number(clip)]?.name}</span></SelectValue></SelectTrigger><SelectContent side="top" align="start" alignItemWithTrigger={false} className="w-auto max-w-[calc(100vw-3rem)]"><SelectGroup>{clips.map((animation, i) => <SelectItem key={i} value={String(i)}>{animation.name} ({animation.duration.toFixed(2)}s)</SelectItem>)}</SelectGroup></SelectContent></Select>
        <Select value={speed} onValueChange={value => { if (value) setSpeed(value); }}><SelectTrigger size="sm" aria-label="Playback speed"><SelectValue>{speed}×</SelectValue></SelectTrigger><SelectContent side="top" align="end" alignItemWithTrigger={false}><SelectGroup>{["0.25", "0.5", "1", "1.5", "2"].map(value => <SelectItem key={value} value={value}>{value}×</SelectItem>)}</SelectGroup></SelectContent></Select>
      </div>}
    </div>
  </div>;
}
