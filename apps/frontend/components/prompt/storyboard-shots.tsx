import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, ClapperboardIcon, DownloadIcon, EllipsisIcon, FilmIcon, GripVerticalIcon, ImageIcon, ListIcon, PencilIcon, RotateCcwIcon, SlidersHorizontalIcon, SquareIcon, Trash2Icon, UserRoundPlusIcon } from "lucide-react";
import { Tip } from "@/components/tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CharacterDialog } from "@/components/character-dialog";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { toast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { storyboardLayout } from "@/lib/image-canvas/storyboard-layout";
import { cn } from "@/lib/utils";
import { shotLimit, shotTextLimits, type Shot, type StoryCharacter } from "./storyboard-data";

const shotDetails = [
  ["camera", "Camera"],
  ["sound", "Sound"],
  ["dialogue", "Dialogue"],
] as const;

export const shotNodeWidth = 240;
// A node is just its 16:9 picture; edges attach to the middle of its sides.
const nodeHeight = (shotNodeWidth * 9) / 16;
const anchorY = nodeHeight / 2;
// Default layout wraps onto a new row after this many shots.
const columns = 4;
const rowHeight = 200;
// Space between the nodes and the edge of the section around them.
const sectionPadding = 28;
// Where a shot sits in the default grid.
export const defaultSpot = (index: number) => ({ x: (index % columns) * (shotNodeWidth + 80), y: Math.floor(index / columns) * rowHeight });
// The soft frame around the shots and finished video, with the midpoint of the last shot.
export function shotsFrame(spots: { x: number; y: number }[], video?: Box | null) {
  const boxes = spots.map((spot) => ({ ...spot, width: shotNodeWidth, height: nodeHeight }));
  if (video) boxes.push(video);
  const left = Math.min(...boxes.map(({ x }) => x)) - sectionPadding;
  const top = Math.min(...boxes.map(({ y }) => y)) - sectionPadding;
  const right = Math.max(...boxes.map(({ x, width }) => x + width)) + sectionPadding;
  const bottom = Math.max(...boxes.map(({ y, height }) => y + height)) + sectionPadding;
  return { left, top, width: right - left, height: bottom - top, anchorY: (spots.at(-1)?.y ?? 0) + anchorY };
}
// Size of the default (undragged) grid for a number of shots.
export function shotGridSize(count: number) {
  return { width: (Math.min(count, columns) - 1) * (shotNodeWidth + 80) + shotNodeWidth, height: (Math.ceil(count / columns) - 1) * rowHeight + nodeHeight };
}

type Box = { x: number; y: number; width: number; height: number };
// A curve from one node to the next: side to side when the next lies to the right, otherwise bottom to top.
function arrow(from: Box, to: Box) {
  const across = to.x >= from.x + from.width;
  const x1 = across ? from.x + from.width : from.x + from.width / 2, y1 = across ? from.y + from.height / 2 : from.y + from.height;
  const x2 = across ? to.x : to.x + to.width / 2, y2 = across ? to.y + to.height / 2 : to.y;
  const bend = Math.max(40, Math.abs(across ? x2 - x1 : y2 - y1) / 2);
  return across ? `M${x1} ${y1}C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}` : `M${x1} ${y1}C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`;
}

// The clip of a shot, played muted on a loop over its picture while the pointer is over the node.
function ShotClip({ id }: { id: string }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    const node = element?.closest("section");
    if (!element || !node) return;
    const enter = () => void element.play().catch(() => {});
    const leave = () => { element.pause(); element.currentTime = 0; };
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    return () => { node.removeEventListener("pointerenter", enter); node.removeEventListener("pointerleave", leave); };
  }, []);
  return <video ref={video} src={`/api/storage/files/${id}`} muted loop playsInline preload="none" aria-hidden="true"
    className="pointer-events-none absolute inset-0 size-full object-cover opacity-0 transition-opacity group-hover/shot:opacity-100" />;
}

// Renders every shot as a draggable picture node on the canvas, joined in order by arrows; the settings icon opens a dialog.
// Must be rendered inside the canvas layer.
export function StoryboardShots({ shots, images, characters, busy, status, onEdit, onReorder, onGenerate, onStop, onMakeVideo, onEditStory, onRedraft, onMoveStart, toolbarActions, renderCharacterReference, renderTakeControls, video }: {
  shots: Shot[];
  images: { name: string; url: string }[];
  characters: StoryCharacter[];
  busy: boolean;
  status: string;
  onEdit: (index: number, change: Partial<Shot>) => void;
  onReorder: (from: number, to: number) => void;
  onGenerate: (index: number) => void;
  onStop: () => void;
  onMakeVideo: () => void;
  onEditStory: () => void;
  onRedraft: () => void;
  onMoveStart: (event: PointerEvent<HTMLElement>) => void;
  toolbarActions?: ReactNode;
  renderCharacterReference: (index: number, close: () => void) => ReactNode;
  renderTakeControls?: (shot: Shot, close: () => void) => ReactNode;
  // The finished video on the canvas, relative to the shots, when there is one; the last shot points to it.
  video?: { x: number; y: number; width: number; height: number } | null;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [referenceCharacter, setReferenceCharacter] = useState<number | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const listContent = useRef<HTMLDivElement>(null);
  const returnToShot = useRef<number | null>(null);
  function closeSettings() {
    setEditing(null);
    setReferenceCharacter(null);
    if (returnToShot.current !== null) setListOpen(true);
  }
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const reorderFrom = useRef<number | null>(null);
  const [saveAs, setSaveAs] = useState<{ id: string; file: File; url: string; x: number; y: number; width: number; height: number }[] | null>(null);
  const [drag, setDrag] = useState<{ index: number; x: number; y: number } | null>(null);
  const place = (index: number) => drag?.index === index ? drag : shots[index].position ?? defaultSpot(index);
  const clipUrl = (shot: Shot) => shot.videoId ? `/api/storage/files/${shot.videoId}` : undefined;
  const pictureUrl = (shot: Shot) => shot.image !== null ? images[shot.image]?.url : shot.generatedId ? `/api/storage/files/${shot.generatedId}` : undefined;

  function start(event: PointerEvent<HTMLDivElement>, index: number) {
    if (event.button !== 0 || !event.isPrimary) return;
    const node = event.currentTarget.parentElement!;
    const scale = node.getBoundingClientRect().width / node.offsetWidth || 1;
    const origin = place(index);
    const from = { x: event.clientX, y: event.clientY };
    let moved = false;
    let latest = origin;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    function move(next: globalThis.PointerEvent) {
      if (!moved && Math.hypot(next.clientX - from.x, next.clientY - from.y) < 3) return;
      moved = true;
      latest = { x: origin.x + (next.clientX - from.x) / scale, y: origin.y + (next.clientY - from.y) / scale };
      setDrag({ index, ...latest });
    }
    function end() {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      setDrag(null);
      if (moved) {
        const layout = storyboardLayout.read();
        if (layout) storyboardLayout.record?.(layout);
        onEdit(index, { position: latest });
      }
    }
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  }

  async function saveAsCharacter(index: number) {
    const url = pictureUrl(shots[index]);
    if (!url) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      setSaveAs([{ id: `shot-${index}`, file: new File([blob], `shot-${index + 1}`, { type: blob.type }), url, x: 0, y: 0, width: 0, height: 0 }]);
    } catch {
      toast.add({ title: "Could not load the shot image", type: "error" });
    }
  }

  function download(index: number, clip = false) {
    const url = clip ? clipUrl(shots[index]) : pictureUrl(shots[index]);
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = clip ? `shot-${index + 1}.mp4` : `shot-${index + 1}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function reset(index: number) {
    const layout = storyboardLayout.read();
    if (layout) storyboardLayout.record?.(layout);
    onEdit(index, { position: undefined });
  }

  function shotActions(index: number, Item: typeof ContextMenuItem | typeof DropdownMenuItem) {
    const item = shots[index];
    const url = pictureUrl(item);
    return <>
      <Item onClick={() => setEditing(index)}><SlidersHorizontalIcon /> Shot settings</Item>
      {!url && <Item disabled={busy || !item.description.trim()} onClick={() => onGenerate(index)}><ImageIcon /> Generate image</Item>}
      {url && <Item onClick={() => void saveAsCharacter(index)}><UserRoundPlusIcon /> Save as character</Item>}
      {url && <Item onClick={() => download(index)}><DownloadIcon /> Export image</Item>}
      {item.videoId && <Item onClick={() => download(index, true)}><DownloadIcon /> Export clip</Item>}
      {item.videoId && <Item disabled={busy} onClick={() => onEdit(index, { videoId: undefined })}><Trash2Icon /> Remove clip</Item>}
      <Item disabled={!item.position} onClick={() => reset(index)}><RotateCcwIcon /> Reset position</Item>
    </>;
  }

  const spots = shots.length ? shots.map((_, index) => place(index)) : [{ x: 0, y: 0 }];
  const frame = shotsFrame(spots, video);
  const shot = editing === null ? undefined : shots[editing];
  const number = (editing ?? 0) + 1;
  const shotCharacters = shot?.characters ?? [];
  const checkingVideo = status === "Checking storyboard…";
  return <>
    {/* The section follows the shots and finished video, with its name and actions on top. */}
    <div aria-hidden="true" className="pointer-events-none absolute rounded-3xl border bg-muted/30" style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }} />
    <svg aria-hidden="true" className="pointer-events-none absolute top-0 left-0 overflow-visible text-muted-foreground/60" width="1" height="1">
      <defs><marker id="shot-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 10 5 0 10z" fill="currentColor" />
      </marker></defs>
      {shots.slice(1).map((_, position) => <path key={position} d={arrow({ ...place(position), width: shotNodeWidth, height: nodeHeight }, { ...place(position + 1), width: shotNodeWidth, height: nodeHeight })} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#shot-arrow)" />)}
      {video && shots.length > 0 && <path d={arrow({ ...place(shots.length - 1), width: shotNodeWidth, height: nodeHeight }, video)} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#shot-arrow)" />}
    </svg>
    <div className="pointer-events-none absolute flex h-10 items-center gap-3" style={{ left: frame.left, top: frame.top - 56, width: frame.width }}>
      <Tip label="Drag or use arrow keys to move the storyboard">
        <Button variant="ghost" size="sm" aria-label="Move storyboard with arrow keys" onPointerDown={onMoveStart}
          className="pointer-events-auto shrink-0 cursor-grab touch-none px-1 text-muted-foreground select-none active:cursor-grabbing"
          onKeyDown={(event) => {
            const direction = {
              ArrowLeft: [-1, 0], ArrowRight: [1, 0],
              ArrowUp: [0, -1], ArrowDown: [0, 1],
            }[event.key];
            if (!direction) return;
            event.preventDefault();
            event.stopPropagation();
            const layout = storyboardLayout.read();
            if (!layout?.origin) return;
            const step = event.shiftKey ? 40 : 10;
            storyboardLayout.record?.(layout);
            storyboardLayout.write({
              ...layout,
              origin: { x: layout.origin.x + direction[0] * step, y: layout.origin.y + direction[1] * step },
            });
          }}>Storyboard</Button>
      </Tip>
    {busy
      ? <div className="pointer-events-auto ml-auto flex w-max min-w-0 items-center gap-2 rounded-full border bg-background py-1 pr-1 pl-3 shadow">
        <p role="status" className="truncate text-sm text-muted-foreground">{status}</p>
        <Button variant="outline" size="sm" onClick={onStop}><SquareIcon data-icon="inline-start" />Stop</Button>
      </div>
      : <div role="toolbar" aria-label="Storyboard actions" className="pointer-events-auto ml-auto flex w-max items-center gap-1 rounded-full border bg-background p-1 shadow">
        <Button size="sm" disabled={checkingVideo} onClick={onMakeVideo}>
          <FilmIcon data-icon="inline-start" />{checkingVideo ? "Checking storyboard…" : "Make video"}
        </Button>
        <Dialog open={listOpen} onOpenChange={setListOpen}>
          <Tip label="Shot list">
            <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Shot list" />}><ListIcon /></DialogTrigger>
          </Tip>
          <DialogContent ref={listContent} initialFocus={() => {
            const index = returnToShot.current;
            returnToShot.current = null;
            return index === null ? undefined : listContent.current?.querySelector<HTMLElement>(`[data-edit-shot="${index}"]`);
          }} className="flex w-[calc(100%-2rem)] min-w-0 max-w-xl flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-xl">
            <DialogHeader className="shrink-0 gap-1 border-b px-4 pt-4 pb-3 pr-14 sm:px-5 sm:pr-14">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>Shot list</DialogTitle>
                <Badge variant="secondary" className="tabular-nums">{shots.length} {shots.length === 1 ? "shot" : "shots"}</Badge>
              </div>
              <DialogDescription>Drag a handle or use the arrows to reorder.</DialogDescription>
            </DialogHeader>
            <ol className="grid min-h-0 min-w-0 grid-cols-1 gap-1.5 overflow-y-auto px-3 py-3 sm:px-4">
              {shots.map((item, index) => {
                const label = `Shot ${index + 1}`;
                const url = pictureUrl(item);
                const scene = item.scene?.trim();
                const description = item.description.trim();
                const title = scene || description || "Untitled shot";
                return <li key={item.id ?? index} className={cn(
                  "grid min-w-0 grid-cols-[0.875rem_3rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-xl border bg-card p-2 min-[420px]:grid-cols-[0.875rem_3rem_minmax(0,1fr)_auto] sm:grid-cols-[1rem_5rem_minmax(0,1fr)_auto] sm:gap-x-3 sm:px-3",
                  dropIndex === index && "border-ring ring-1 ring-ring",
                )}
                  onDragOver={(event) => {
                    if (reorderFrom.current === null) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropIndex(reorderFrom.current === index ? null : index);
                  }}
                  onDrop={(event) => {
                    const from = reorderFrom.current;
                    if (from === null) return;
                    event.preventDefault();
                    reorderFrom.current = null;
                    setDropIndex(null);
                    if (from !== index) onReorder(from, index);
                  }}>
                  <span aria-hidden="true" draggable className="row-span-2 cursor-grab touch-none text-muted-foreground active:cursor-grabbing min-[420px]:row-span-1"
                    onDragStart={(event) => {
                      reorderFrom.current = index;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", label);
                    }}
                    onDragEnd={() => { reorderFrom.current = null; setDropIndex(null); }}>
                    <GripVerticalIcon className="size-4" />
                  </span>
                  <div className="row-span-2 flex aspect-video min-w-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground min-[420px]:row-span-1">
                    {url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={url} alt="" className="size-full object-cover" />
                      : <ImageIcon aria-label="No image" className="size-4" />}
                  </div>
                  <div className="col-start-3 min-w-0 space-y-0.5">
                    <p className="truncate text-xs tabular-nums text-muted-foreground">{label} · {item.seconds}s</p>
                    <p className="line-clamp-2 text-sm leading-snug font-medium wrap-anywhere" title={title}>{title}</p>
                    {scene && description && <p className="truncate text-xs text-muted-foreground" title={description}>{description}</p>}
                  </div>
                  <div className="col-start-3 flex shrink-0 items-center justify-self-end rounded-full bg-muted/60 p-0.5 min-[420px]:col-start-auto">
                    <Tip label="Move up"><Button variant="ghost" size="icon-xs" aria-label={`Move ${label.toLowerCase()} up`} disabled={index === 0} onClick={() => onReorder(index, index - 1)}><ArrowUpIcon /></Button></Tip>
                    <Tip label="Move down"><Button variant="ghost" size="icon-xs" aria-label={`Move ${label.toLowerCase()} down`} disabled={index === shots.length - 1} onClick={() => onReorder(index, index + 1)}><ArrowDownIcon /></Button></Tip>
                    <Tip label="Shot settings"><Button variant="ghost" size="icon-xs" aria-label={`Edit ${label.toLowerCase()} settings`} data-edit-shot={index}
                      onClick={() => { returnToShot.current = index; setListOpen(false); setEditing(index); }}><SlidersHorizontalIcon /></Button></Tip>
                  </div>
                </li>;
              })}
            </ol>
          </DialogContent>
        </Dialog>
        {toolbarActions}
        <Tip label="Edit story"><Button variant="ghost" size="icon-sm" aria-label="Edit story" onClick={onEditStory}><PencilIcon /></Button></Tip>
        <Tip label="Redraft shots"><Button variant="ghost" size="icon-sm" aria-label="Redraft shots" onClick={onRedraft}><ClapperboardIcon /></Button></Tip>
      </div>}
    </div>
    {shots.map((item, index) => {
      const { x, y } = place(index);
      const url = pictureUrl(item);
      return <ContextMenu key={item.id ?? index}>
        <ContextMenuTrigger render={<section aria-label={`Shot ${index + 1}`} style={{ left: x, top: y, width: shotNodeWidth, height: nodeHeight }} className="group/shot absolute" onContextMenu={(event) => event.stopPropagation()} />}>
        <div onPointerDown={(event) => start(event, index)} onDoubleClick={() => setEditing(index)}
          className="relative flex size-full cursor-grab touch-none items-center justify-center overflow-hidden rounded-2xl border bg-muted text-muted-foreground shadow-sm select-none active:cursor-grabbing">
          {url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={url} alt={`Shot ${index + 1}`} draggable={false} className="size-full object-cover" />
            : <ImageIcon aria-hidden="true" className="size-5" />}
          {item.videoId && <ShotClip key={item.videoId} id={item.videoId} />}
        </div>
        <Badge variant="secondary" className="pointer-events-none absolute top-2 left-2 bg-background/85"><ClapperboardIcon data-icon="inline-start" />{index + 1}</Badge>
        {item.videoId && <Badge variant="secondary" title="Clip ready" aria-label="Clip ready" className="pointer-events-none absolute bottom-2 left-2 size-5 bg-background/85 p-0"><FilmIcon /></Badge>}
        <DropdownMenu>
          <Tip label="Shot actions">
            <DropdownMenuTrigger render={<Button type="button" variant="secondary" size="icon-xs" data-canvas-interactive
              aria-label={`Actions for shot ${index + 1}`} className="absolute top-2 right-2" />}><EllipsisIcon /></DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent data-canvas-interactive>
            <DropdownMenuGroup>{shotActions(index, DropdownMenuItem)}</DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        </ContextMenuTrigger>
        <ContextMenuContent data-canvas-interactive>
          <ContextMenuGroup>{shotActions(index, ContextMenuItem)}</ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>;
    })}
    {saveAs && <CharacterDialog images={saveAs} onClose={() => setSaveAs(null)} />}
    <Dialog open={!!shot} onOpenChange={(open) => { if (!open) closeSettings(); }}>
      {shot && editing !== null && <DialogContent className="gap-4 p-5 sm:max-w-lg">
        <DialogHeader className="flex-row items-center gap-3 pr-7">
          <div className="flex aspect-video w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground sm:w-28">
            {pictureUrl(shot)
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={pictureUrl(shot)} alt={`Shot ${number}`} className="size-full object-cover" />
              : <ImageIcon aria-label="Needs an image" className="size-4" />}
          </div>
          <div className="grid gap-1">
            <DialogTitle>Shot {number} settings</DialogTitle>
            <DialogDescription>Shot {number} of {shots.length}</DialogDescription>
          </div>
        </DialogHeader>
        <Tabs defaultValue="details">
          <TabsList className="w-full" aria-label="Shot settings sections">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="references">References</TabsTrigger>
            {renderTakeControls && <TabsTrigger value="takes">Takes</TabsTrigger>}
          </TabsList>
          <TabsContent value="details" className="pt-1">
            <FieldGroup className="gap-3">
              <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
                <Field className="gap-1">
                  <FieldLabel htmlFor={`shot-scene-${number}`}>Scene</FieldLabel>
                  <Input id={`shot-scene-${number}`} value={shot.scene ?? ""} maxLength={shotTextLimits.scene} disabled={busy}
                    onChange={(event) => onEdit(editing, { scene: event.target.value })} />
                </Field>
                <Field className="gap-1">
                  <FieldLabel htmlFor={`shot-time-${number}`}>Seconds</FieldLabel>
                  <Input key={editing} id={`shot-time-${number}`} type="number" min={1} max={60} step="any" defaultValue={shot.seconds} disabled={busy}
                    onBlur={(event) => {
                      const value = event.target.valueAsNumber;
                      const seconds = Number.isFinite(value) ? Math.min(60, Math.max(1, value)) : shot.seconds;
                      event.target.value = String(seconds);
                      onEdit(editing, { seconds });
                    }} />
                </Field>
              </div>
              <Field className="gap-1">
                <FieldLabel htmlFor={`shot-${number}`}>Description</FieldLabel>
                <Textarea id={`shot-${number}`} className="min-h-0 field-sizing-fixed resize-y py-2" rows={2} value={shot.description}
                  maxLength={shotLimit} disabled={busy} onChange={(event) => onEdit(editing, { description: event.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                {shotDetails.map(([field, label]) => {
                  const inputId = `shot-${number}-${field}`;
                  return <Field key={field} className={field === "dialogue" ? "gap-1 sm:col-span-2" : "gap-1"}>
                    <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
                    <Textarea id={inputId} className="min-h-0 field-sizing-fixed resize-y py-2" rows={field === "dialogue" ? 2 : 1}
                      value={shot[field] ?? ""} maxLength={shotTextLimits[field]} disabled={busy}
                      onChange={(event) => onEdit(editing, { [field]: event.target.value })} />
                  </Field>;
                })}
              </div>
            </FieldGroup>
          </TabsContent>
          <TabsContent value="references" className="min-w-0 space-y-4 pt-2">
            <fieldset className="min-w-0">
              <legend className="text-sm font-medium">Characters</legend>
              <p className="mb-2 text-xs text-muted-foreground">Who appears in this shot.</p>
              {characters.length ? <ul className="divide-y rounded-xl border">
                {characters.map((character, position) => {
                  const label = character.name.trim() || `Character ${position + 1}`;
                  const selected = shotCharacters.includes(position);
                  const expanded = referenceCharacter === position;
                  const url = character.image !== null ? images[character.image]?.url
                    : character.approved && character.generatedId ? `/api/storage/files/${character.generatedId}` : undefined;
                  return <li key={position} className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1 px-2 py-1">
                      <Button type="button" variant="ghost" disabled={busy} aria-pressed={selected}
                        className="h-11 min-w-0 flex-1 justify-start gap-2 rounded-lg px-1.5"
                        onClick={() => onEdit(editing, { characters: selected
                          ? shotCharacters.filter((index) => index !== position)
                          : [...shotCharacters, position] })}>
                        <span className={cn("grid size-4 shrink-0 place-items-center rounded-sm border", selected && "border-primary bg-primary text-primary-foreground")}>
                          {selected && <CheckIcon aria-hidden="true" className="size-3" />}
                        </span>
                        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-muted">
                          {url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={url} alt="" className="size-full object-cover" />
                            : label.charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1 text-left" title={label}>
                          <span className="block truncate">{label}</span>
                          {!url && <span className="block text-xs font-normal text-muted-foreground">No reference</span>}
                        </span>
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="gap-1 rounded-lg px-2 text-xs text-muted-foreground"
                        aria-label={`Set reference for ${label}`} aria-expanded={expanded}
                        onClick={() => setReferenceCharacter(expanded ? null : position)}>
                        {url ? "Reference" : "Set reference"}
                        <ChevronDownIcon aria-hidden="true" className={cn("size-3", expanded && "rotate-180")} />
                      </Button>
                    </div>
                    {expanded && renderCharacterReference(position, () => setReferenceCharacter(null))}
                  </li>;
                })}
              </ul> : <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">No characters in this storyboard.</p>}
            </fieldset>
            <fieldset disabled={busy} className="min-w-0">
              <legend className="text-sm font-medium">Reference images</legend>
              <p className="mb-2 text-xs text-muted-foreground">Visual guides for the setting, props, or style.</p>
              {images.length ? <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3">
                {images.map((image, index) => {
                  const selected = shot.references.includes(index);
                  const label = image.name || `Image ${index + 1}`;
                  return <Button key={index} type="button" variant="outline" aria-pressed={selected}
                    className="relative h-auto min-w-0 flex-col items-start gap-1.5 rounded-xl p-1.5 aria-pressed:border-primary aria-pressed:bg-accent"
                    onClick={() => onEdit(editing, { references: selected
                      ? shot.references.filter((reference) => reference !== index)
                      : [...shot.references, index] })}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.url} alt="" className="aspect-video w-full rounded-md object-cover" />
                    {selected && <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                      <CheckIcon aria-hidden="true" className="size-3" />
                    </span>}
                    <span className="w-full truncate px-0.5 text-left text-xs" title={label}>{label}</span>
                  </Button>;
                })}
              </div> : <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">No reference images in this storyboard.</p>}
            </fieldset>
          </TabsContent>
          {renderTakeControls && <TabsContent value="takes" className="pt-1">{renderTakeControls(shot, closeSettings)}</TabsContent>}
        </Tabs>
        <DialogFooter>
          {!pictureUrl(shot) && <Button type="button" size="sm" variant="outline" disabled={busy || !shot.description.trim()} onClick={() => { onGenerate(editing); closeSettings(); }}>
            <ImageIcon data-icon="inline-start" />Generate image
          </Button>}
          <Button type="button" size="sm" onClick={closeSettings}>Done</Button>
        </DialogFooter>
      </DialogContent>}
    </Dialog>
  </>;
}
