"use client";

import { Tip } from "@/components/tip";
import { ConfirmDelete } from "@/components/confirm-delete";

import { useRef, useState } from "react";
import { BoxIcon, CheckIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import type { VisibleImage } from "@/components/image-canvas";
import { multiviewConfig, multiviewRequirements } from "./multiview";
import { modelViews, multiviewError, type ModelView, type ModelViews } from "./generation";

export function MultiviewInput({ model, views, onChange, selection, disabled, onBusy }: {
  model: string; views: ModelViews; onChange: (views: ModelViews) => void;
  selection: VisibleImage[]; disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const busy = useRef(false);
  const [deletingView, setDeletingView] = useState<ModelView | null>(null);
  const images = selection.filter((item) => /^image\/(png|jpeg|webp)$/.test(item.file.type));
  const error = multiviewError(model, views);
  async function assign(view: ModelView, file: File) {
    if (busy.current || disabled) return;
    busy.current = true;
    onBusy(true);
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || !file.size || file.size > 20 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP image under 20 MB.");
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read image. Try again."));
        reader.readAsDataURL(file);
      });
      const next = { ...views, [view]: { url, name: file.name } };
      const previous = modelViews.find((key) => key !== view && views[key]?.url === url);
      if (previous) {
        if (views[view]) next[previous] = views[view];
        else delete next[previous];
      }
      if (Object.values(next).reduce((sum, image) => sum + image.url.length, 0) > Math.ceil(20 * 1024 * 1024 / 3) * 4 + 256) throw new Error("View images exceed 20 MB. Use smaller images.");
      onChange(next);
    } catch (cause) {
      toast.add({ title: cause instanceof Error ? cause.message : "Could not load image", type: "error" });
    } finally { busy.current = false; onBusy(false); }
  }
  const config = multiviewConfig(model);
  return <div className="flex flex-col gap-3 border-t px-3 py-4" aria-label="Multiview images">
    <div className="flex items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-sm font-medium"><BoxIcon className="size-4 text-muted-foreground" aria-hidden="true" />Images to 3D</p>
      <Badge variant="secondary">{Object.keys(views).length} added</Badge>
    </div>
    <ConfirmDelete open={!!deletingView} onOpenChange={(open) => { if (!open) setDeletingView(null); }} title="Remove view image?" actionLabel="Remove" description={`The ${deletingView} view image will be removed from this input.`} disabled={disabled} onConfirm={async () => { if (deletingView && !disabled) { const next = { ...views }; delete next[deletingView]; onChange(next); } }} />
    <FieldGroup className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(config?.order ?? modelViews).map((view) => <Field key={view} className="min-w-0 gap-2">
        <div className="relative">
          <input id={`multiview-${view}`} className="peer sr-only" type="file" accept={config?.pngJpegOnly ? "image/png,image/jpeg" : "image/png,image/jpeg,image/webp"} disabled={disabled} aria-label={`Upload ${view} view`} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void assign(view, file); }} />
          <label htmlFor={`multiview-${view}`} className="flex h-28 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed bg-muted/20 text-muted-foreground transition-colors hover:bg-muted/60 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:pointer-events-none peer-disabled:opacity-50 sm:h-32">
          {views[view] ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={views[view].url} alt={`${view}: ${views[view].name}`} className="size-full object-contain p-2" />
          <span className="sr-only">Replace {view} view</span>
          </> : <><PlusIcon className="size-5" aria-hidden="true" /><span className="text-xs">Add image</span></>}
          </label>
          {views[view] && <Tip label={`Remove ${view} view`}><Button type="button" variant="secondary" size="icon-xs" className="absolute top-1.5 right-1.5" aria-label={`Remove ${view} view`} disabled={disabled} onClick={() => setDeletingView(view)}><XIcon /></Button></Tip>}
        </div>
        <div className="flex items-center justify-between gap-1">
          <FieldLabel htmlFor={`multiview-${view}`} className="text-xs">{view[0].toUpperCase() + view.slice(1)}</FieldLabel>
          <span className="text-xs text-muted-foreground">{config?.required.includes(view) ? "Required" : "Optional"}</span>
        </div>
        {images.length > 0 && <Select value={null} disabled={disabled} onValueChange={(id) => { const item = images.find((image) => image.id === id); if (item) void assign(view, item.file); }}>
          <SelectTrigger size="sm" className="w-full min-w-0" aria-label={`Choose ${view} from canvas`}><SelectValue placeholder="Use canvas image" /></SelectTrigger>
          <SelectContent><SelectGroup>{images.map((image) => <SelectItem key={image.id} value={image.id}>{image.file.name}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>}
      </Field>)}
    </FieldGroup>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <p role="status" className="flex items-center gap-1.5">{!error && <CheckIcon className="size-3.5" aria-hidden="true" />}{error ?? "Ready to create"}</p>
      <span>{multiviewRequirements(model)} · 20 MB total</span>
    </div>
  </div>;
}
