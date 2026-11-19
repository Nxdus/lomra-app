import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ClapperboardIcon, DownloadIcon, FilmIcon, ImageIcon, PencilIcon, RotateCcwIcon, SlidersHorizontalIcon, Trash2Icon, UserRoundPlusIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CharacterDialog } from "@/components/character-dialog";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { toast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { storyboardLayout } from "@/lib/image-canvas/storyboard-layout";
import { shotLimit, type Shot, type StoryCharacter } from "./storyboard-data";

export const shotNodeWidth = 240;
// A node is just its 16:9 picture; edges attach to the middle of its sides.
const nodeHeight = (shotNodeWidth * 9) / 16;
const anchorY = nodeHeight / 2;
// Default layout wraps onto a new row after this many shots.
const columns = 4;
const rowHeight = 200;
// Space between the nodes and the edge of the section around them.
const sectionPadding = 28;
// Where the shot nodes start, to the right of the 460px cast card.
export const shotsOffset = 460 + 80;
// Where a shot sits in the default grid.
export const defaultSpot = (index: number) => ({ x: (index % columns) * (shotNodeWidth + 80), y: Math.floor(index / columns) * rowHeight });
// The soft frame around the nodes at these positions, with the middle of the last node's row (where the video joins).
export function shotsFrame(spots: { x: number; y: number }[]) {
  const left = Math.min(...spots.map(({ x }) => x)) - sectionPadding, top = Math.min(...spots.map(({ y }) => y)) - sectionPadding;
  return { left, top, width: Math.max(...spots.map(({ x }) => x)) + shotNodeWidth + sectionPadding - left, height: Math.max(...spots.map(({ y }) => y)) + nodeHeight + sectionPadding - top, anchorY: (spots.at(-1)?.y ?? 0) + anchorY };
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
export function StoryboardShots({ shots, images, characters, busy, status, onEdit, onGenerate, onStop, onMakeVideo, onEditStory, onRedraft, onMoveStart, video }: {
  shots: Shot[];
  images: { name: string; url: string }[];
  characters: StoryCharacter[];
  busy: boolean;
  status: string;
  onEdit: (index: number, change: Partial<Shot>) => void;
  onGenerate: (index: number) => void;
  onStop: () => void;
  onMakeVideo: () => void;
  onEditStory: () => void;
  onRedraft: () => void;
  onMoveStart: (event: PointerEvent<HTMLElement>) => void;
  // The finished video on the canvas, relative to the shots, when there is one; the last shot points to it.
  video?: { x: number; y: number; width: number; height: number } | null;
}) {
  const [editing, setEditing] = useState<number | null>(null);
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

  const spots = shots.length ? shots.map((_, index) => place(index)) : [{ x: 0, y: 0 }];
  const frame = shotsFrame(spots);
  const shot = editing === null ? undefined : shots[editing];
  const number = (editing ?? 0) + 1;
  // Only the characters Lomra placed in this shot; they are read-only.
  const cast = (shot?.characters ?? []).flatMap((position) => characters[position] ? [{ character: characters[position], position }] : []);
  return <>
    {/* A Figma-style section: a soft frame around every shot (it follows dragged nodes) with its name and actions on top. */}
    <div aria-hidden="true" className="pointer-events-none absolute rounded-3xl border bg-muted/30" style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }} />
    <svg aria-hidden="true" className="pointer-events-none absolute top-0 left-0 overflow-visible text-muted-foreground/60" width="1" height="1">
      <defs><marker id="shot-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 10 5 0 10z" fill="currentColor" />
      </marker></defs>
      {shots.slice(1).map((_, position) => <path key={position} d={arrow({ ...place(position), width: shotNodeWidth, height: nodeHeight }, { ...place(position + 1), width: shotNodeWidth, height: nodeHeight })} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#shot-arrow)" />)}
      {video && <path d={arrow({ ...place(shots.length - 1), width: shotNodeWidth, height: nodeHeight }, video)} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd="url(#shot-arrow)" />}
    </svg>
    <div className="pointer-events-none absolute flex h-10 items-center gap-3" style={{ left: frame.left, top: frame.top - 56, width: frame.width }}>
      <h3 onPointerDown={onMoveStart} title="Drag to move the storyboard" className="pointer-events-auto shrink-0 cursor-grab touch-none rounded-md px-1 text-sm leading-none font-medium text-muted-foreground select-none active:cursor-grabbing">Storyboard</h3>
    {busy
      ? <div className="pointer-events-auto ml-auto flex w-max min-w-0 items-center gap-2 rounded-full border bg-background py-1 pr-1 pl-3 shadow">
        <p role="status" className="truncate text-sm text-muted-foreground">{status}</p>
        <Button variant="outline" size="sm" onClick={onStop}>Stop</Button>
      </div>
      : <div role="toolbar" aria-label="Storyboard actions" className="pointer-events-auto ml-auto flex w-max items-center gap-1 rounded-full border bg-background p-1 shadow">
        <Button size="sm" onClick={onMakeVideo}><FilmIcon data-icon="inline-start" />Make video</Button>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit story" onClick={onEditStory} />}><PencilIcon /></TooltipTrigger>
          <TooltipContent>Edit story</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Redraft shots" onClick={onRedraft} />}><ClapperboardIcon /></TooltipTrigger>
          <TooltipContent>Redraft shots</TooltipContent>
        </Tooltip>
      </div>}
    </div>
    {shots.map((item, index) => {
      const { x, y } = place(index);
      const url = pictureUrl(item);
      return <ContextMenu key={index}>
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
        </ContextMenuTrigger>
        <ContextMenuContent data-canvas-interactive>
          <ContextMenuGroup>
            <ContextMenuItem onClick={() => setEditing(index)}><SlidersHorizontalIcon /> Shot settings</ContextMenuItem>
            {!url && <ContextMenuItem disabled={busy || !item.description.trim()} onClick={() => onGenerate(index)}><ImageIcon /> Generate image</ContextMenuItem>}
            {url && <ContextMenuItem onClick={() => void saveAsCharacter(index)}><UserRoundPlusIcon /> Save as Character</ContextMenuItem>}
            {url && <ContextMenuItem onClick={() => download(index)}><DownloadIcon /> Download image</ContextMenuItem>}
            {item.videoId && <ContextMenuItem onClick={() => download(index, true)}><DownloadIcon /> Download clip</ContextMenuItem>}
            {item.videoId && <ContextMenuItem disabled={busy} onClick={() => onEdit(index, { videoId: undefined })}><Trash2Icon /> Remove clip</ContextMenuItem>}
            <ContextMenuItem disabled={!item.position} onClick={() => reset(index)}><RotateCcwIcon /> Reset position</ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>;
    })}
    {saveAs && <CharacterDialog images={saveAs} onClose={() => setSaveAs(null)} />}
    <Dialog open={!!shot} onOpenChange={(open) => { if (!open) setEditing(null); }}>
      {shot && editing !== null && <DialogContent>
        <DialogHeader>
          <DialogTitle>Shot {number}</DialogTitle>
          <DialogDescription>Shot {number} of {shots.length}. Describe the frame, then choose or generate its image.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl border bg-muted text-muted-foreground">
            {pictureUrl(shot)
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={pictureUrl(shot)} alt={`Shot ${number}`} className="size-full object-cover" />
              : <span className="flex items-center gap-2 text-sm"><ImageIcon className="size-4" />Needs an image</span>}
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`shot-${number}`}>Description</FieldLabel>
              <Textarea id={`shot-${number}`} rows={4} value={shot.description} maxLength={shotLimit} disabled={busy}
                onChange={(event) => onEdit(editing, { description: event.target.value })} />
            </Field>
            <div className="flex items-end gap-4">
              <Field className="w-28 shrink-0">
                <FieldLabel htmlFor={`shot-time-${number}`}>Seconds</FieldLabel>
                <Input key={editing} id={`shot-time-${number}`} type="number" min={1} max={60} step="any" defaultValue={shot.seconds} disabled={busy}
                  onBlur={(event) => {
                    const value = event.target.valueAsNumber;
                    const seconds = Number.isFinite(value) ? Math.min(60, Math.max(1, value)) : shot.seconds;
                    event.target.value = String(seconds);
                    onEdit(editing, { seconds });
                  }} />
              </Field>
              {cast.length > 0 && <Field>
                <FieldLabel>Characters</FieldLabel>
                <ul aria-label={`Characters in shot ${number}`} className="flex items-center pl-2">
                  {cast.map(({ character, position }) => {
                    const label = character.name.trim() || `Character ${position + 1}`;
                    const url = character.image !== null ? images[character.image]?.url : character.generatedId ? `/api/storage/files/${character.generatedId}` : undefined;
                    return <li key={position} title={label} aria-label={label} className="relative -ml-2 flex size-9 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium ring-2 ring-background transition-transform hover:z-10 hover:scale-110">
                      {url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={url} alt="" className="size-full object-cover" />
                        : label.charAt(0).toUpperCase()}
                    </li>;
                  })}
                </ul>
              </Field>}
            </div>
          </FieldGroup>
          <DialogFooter>
            {!pictureUrl(shot) && <Button type="button" variant="outline" disabled={busy || !shot.description.trim()} onClick={() => { onGenerate(editing); setEditing(null); }}>
              <ImageIcon data-icon="inline-start" />Generate image
            </Button>}
            <Button type="button" onClick={() => setEditing(null)}>Done</Button>
          </DialogFooter>
        </div>
      </DialogContent>}
    </Dialog>
  </>;
}
