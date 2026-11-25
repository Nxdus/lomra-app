"use client";

import { useState, type ReactNode } from "react";
import { BoxIcon, CheckIcon, CopyIcon, FileTextIcon, Grid2x2Icon, ImageIcon, SparklesIcon, VideoIcon } from "lucide-react";
import { CanvasMedia } from "@/components/canvas-media";
import type { VisibleImage } from "@/components/image-canvas";
import { isLocal3dModel, isLocalPictureModel, isSdModel, local3dPrefix, pictureAiPrefix, sdPrefix } from "@/components/prompt/generation";
import { Tip } from "@/components/tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useLocal3d } from "@/hooks/use-local3d";
import { usePictureAi } from "@/hooks/use-picture-ai";
import { useSd } from "@/hooks/use-sd";
import type { CanvasProvenance } from "@/lib/image-canvas/canvas-harness";
import { canvasFileKind, isCanvasFilePending } from "@/lib/image-canvas/image-canvas-storage";
import { canMakeVariationsFromProvenance } from "@/lib/image-canvas/provenance-setup";
import { cn } from "@/lib/utils";

const fileSize = (bytes: number) => bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <Tip label={copied ? "Copied" : "Copy"}><Button type="button" variant="ghost" size="icon-xs" aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`} onClick={async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.add({ title: `Could not copy the ${label.toLowerCase()}.`, type: "error" }); }
  }}>{copied ? <CheckIcon /> : <CopyIcon />}</Button></Tip>;
}

function Fact({ label, value, copy, wide }: { label: string; value: string; copy?: boolean; wide?: boolean }) {
  return <div className={cn("flex min-w-0 items-center justify-between gap-1 rounded-2xl bg-muted/60 px-3 py-2", wide && "col-span-2")}>
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium tabular-nums" title={value}>{value}</dd>
    </div>
    {copy && <CopyButton value={value} label={label} />}
  </div>;
}

/** A small picture of a canvas item, or an icon for what it is. */
export function ItemThumbnail({ item }: { item?: VisibleImage }) {
  const kind = item && canvasFileKind(item.file);
  return <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground [&_svg]:size-4">
    {item?.url && kind === "image"
      // Local blob URLs need no Next.js image optimization.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={item.url} alt="" className="size-full object-cover" />
      : kind === "video" ? <VideoIcon aria-hidden="true" /> : kind === "3d" ? <BoxIcon aria-hidden="true" /> : kind === "image" ? <ImageIcon aria-hidden="true" /> : <FileTextIcon aria-hidden="true" />}
  </span>;
}

/** The name a model goes by; the id of one that is gone, or that Lomra has no name for. */
function ModelBadge({ model }: { model: string }) {
  const sd = useSd();
  const pictureAi = usePictureAi();
  const local3d = useLocal3d();
  const name = isSdModel(model) ? sd.status?.models.find((item) => item.id === model.slice(sdPrefix.length))?.name
    : isLocalPictureModel(model) ? pictureAi.status?.models.find((item) => item.id === model.slice(pictureAiPrefix.length))?.name
    : isLocal3dModel(model) ? local3d.status?.models.find((item) => item.id === model.slice(local3dPrefix.length))?.name : undefined;
  return <Badge variant="secondary" className="max-w-full" title={model}><span className="truncate">{name ?? model}</span></Badge>;
}

function Generation({ provenance, items }: { provenance: CanvasProvenance; items: VisibleImage[] }) {
  const { model, prompt, sd, selectedInputs = [] } = provenance;
  return <section aria-label="Generation" className="flex flex-col gap-4">
    {prompt && <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2"><h3 className="font-medium">Prompt</h3><CopyButton value={prompt} label="Prompt" /></div>
      <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground">{prompt}</p>
    </div>}
    {sd && <dl className="grid grid-cols-2 gap-2">
      <Fact label="Seed" value={String(sd.seed)} copy wide={sd.strength === undefined} />
      {sd.strength !== undefined && <Fact label="Strength" value={String(sd.strength)} />}
      <Fact label="Steps" value={String(sd.steps)} />
      <Fact label="CFG scale" value={String(sd.cfg)} />
    </dl>}
    {sd?.negativePrompt && <div className="flex flex-col gap-1">
      <h3 className="text-xs text-muted-foreground">Negative prompt</h3>
      <p className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words">{sd.negativePrompt}</p>
    </div>}
    {selectedInputs.length > 0 && <div className="flex flex-col gap-1.5">
      <h3 className="text-xs text-muted-foreground">{selectedInputs.length === 1 ? "Made from" : `Made from ${selectedInputs.length} items`}</h3>
      <ul className="flex flex-wrap gap-2">{selectedInputs.map((input) => <li key={input.id} className="flex min-w-0 max-w-full items-center gap-2">
        <ItemThumbnail item={items.find((item) => item.id === input.id)} /><span className="truncate" title={input.name}>{input.name}</span>
      </li>)}</ul>
    </div>}
    <div className="flex flex-wrap gap-1.5">
      <ModelBadge model={model} />
      {provenance.aspectRatio && <Badge variant="secondary">{provenance.aspectRatio}</Badge>}
      {sd?.image && <Badge variant="secondary">{sd.mask ? "Brushed area only" : "From a picture"}</Badge>}
    </div>
  </section>;
}

/** The left side of Canvas details: the item itself, and how it was made or else what file it is. */
export function CanvasItemSummary({ item, items, onLoaded, onUseSetup, onMakeVariations, busy }: {
  item: VisibleImage;
  items: VisibleImage[];
  onLoaded: (id: string, file: File) => void;
  onUseSetup?: (item: VisibleImage) => void;
  onMakeVariations?: (item: VisibleImage) => void;
  busy?: boolean;
}) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  const kind = canvasFileKind(item.file);
  const provenance = item.harness?.provenance;
  const sd = useSd();
  const canVary = kind === "image" && canMakeVariationsFromProvenance(provenance);
  const sdModelInstalled = !canVary || !sd.status || sd.status.models.some((m) => m.installed && `${sdPrefix}${m.id}` === provenance!.model);
  let preview: ReactNode = <CanvasMedia image={item} onLoaded={onLoaded} />;
  if (kind === "image" && item.url) {
    // Local blob URLs need no Next.js image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    preview = <img src={item.url} alt={item.file.name} className="size-full object-contain" onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />;
  }
  return <div className="flex min-w-0 flex-col gap-4">
    <div className="max-h-96 w-full overflow-hidden rounded-3xl bg-muted/60" style={{ aspectRatio: `${item.width} / ${item.height}` }}>{preview}</div>
    {provenance ? <>
      {kind === "image" && (onUseSetup || (canVary && onMakeVariations)) && (
        <div className="flex flex-wrap gap-2">
          {onUseSetup && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onUseSetup(item)}>
            <SparklesIcon data-icon="inline-start" />Use this setup
          </Button>}
          {canVary && onMakeVariations && <Tip label={!sdModelInstalled ? "Install this model in Settings → Local models first" : "Generate 4 variations with different seeds"}>
            <Button type="button" variant="secondary" size="sm" disabled={busy || !sdModelInstalled} onClick={() => onMakeVariations(item)}>
              <Grid2x2Icon data-icon="inline-start" />Make 4 variations
            </Button>
          </Tip>}
        </div>
      )}
      <Generation provenance={provenance} items={items} />
    </> : <dl aria-label="File" className="grid grid-cols-2 gap-2">
      <Fact label="Type" value={item.file.name.includes(".") ? item.file.name.slice(item.file.name.lastIndexOf(".") + 1).toUpperCase() : item.file.type || "Unknown"} />
      {size && <Fact label="Dimensions" value={`${size.width} × ${size.height}`} />}
      {!isCanvasFilePending(item.file) && item.file.size > 0 && <Fact label="Size" value={fileSize(item.file.size)} />}
      {item.file.lastModified > 0 && <Fact label="Date" value={new Date(item.file.lastModified).toLocaleDateString()} />}
    </dl>}
  </div>;
}
