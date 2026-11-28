"use client";

import { ArrowLeftIcon, CheckIcon, FilmIcon, GitMergeIcon, ImageIcon, Loader2Icon, ScanEyeIcon, ScissorsIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Storyboard } from "./storyboard-data";
import {
  applyReviewProposal, parseReview, planReview, reviewImageLimit, reviewImages, reviewInstruction,
  reviewReferences, reviewShots, type ReviewImage, type ReviewProposal,
} from "./storyboard-review-data";

export type StoryboardReviewProps = {
  storyboard: Storyboard;
  images: readonly ReviewImage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Change this when the owner, canvas, or selected model changes. */
  contextKey: string;
  /** Provide a message when the selected chat model cannot receive images. */
  unavailableReason?: string;
  /** Configured chat models that accept images, offered in the dialog when the selected one cannot review. */
  visionModels?: readonly { id: string; name: string }[];
  /** Makes `id` the selected chat model. */
  onSelectModel?: (id: string) => void;
  /** The storyboard chat completion path, with no prior messages or tools. */
  complete: (instruction: string, text: string, images: ReviewImage[], signal: AbortSignal) => Promise<unknown>;
  onUpdate: (update: (current: Storyboard | undefined) => Storyboard | undefined) => void;
};

export function StoryboardReview({ open, onOpenChange, ...props }: StoryboardReviewProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100%-2rem)] min-w-0 max-w-4xl flex-col gap-4 overflow-hidden rounded-3xl p-4 sm:max-w-4xl sm:p-6">
        <DialogHeader className="shrink-0 gap-1 pr-7">
          <DialogTitle>AI Storyboard Review</DialogTitle>
          <DialogDescription>Selected frames and references are sent to your chat model.</DialogDescription>
        </DialogHeader>
        {open && <ReviewForm key={props.contextKey} {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function toggle(values: ReadonlySet<string>, id: string, checked: boolean) {
  const next = new Set(values);
  if (checked) next.add(id);
  else next.delete(id);
  return next;
}

function timestamp(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, "0")}`;
}

type ReviewResult = ReturnType<typeof parseReview> & { snapshot: string };
type ReviewShots = ReturnType<typeof reviewShots>;

function ReviewForm({ storyboard, images, unavailableReason, visionModels, onSelectModel, complete, onUpdate }: Omit<StoryboardReviewProps, "open" | "onOpenChange">) {
  const [tab, setTab] = useState("selection");
  const [selected, setSelected] = useState(new Set<string>());
  const [approved, setApproved] = useState(new Set<string>());
  const [result, setResult] = useState<ReviewResult>();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [confirmedSnapshot, setConfirmedSnapshot] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  const boardSnapshot = JSON.stringify(storyboard);
  const shotOptions = reviewShots(storyboard, images);
  const shots = shotOptions.filter(({ id }) => selected.has(id));
  const referenceOptions = reviewReferences(storyboard, images, selected);
  const references = referenceOptions.filter(({ key }) => approved.has(key));
  const snapshot = JSON.stringify([boardSnapshot, shots, references, !!unavailableReason]);
  const latest = useRef(snapshot);
  useLayoutEffect(() => { latest.current = snapshot; }, [snapshot]);
  useEffect(() => () => controller.current?.abort(), []);
  const stale = !!result && result.snapshot !== snapshot;
  const applied = confirmedSnapshot !== undefined && confirmedSnapshot === boardSnapshot;
  const overLimit = shots.length + references.length > reviewImageLimit;
  const plan = shots.length && !overLimit ? planReview(shots, references) : undefined;
  const imageCount = plan ? plan.reduce((total, shot) => total + shot.samples.length, references.length) : shots.length + references.length;

  async function review() {
    if (controller.current || unavailableReason || !plan) return;
    const run = new AbortController();
    controller.current = run;
    const { signal } = run;
    setError("");
    setResult(undefined);
    setConfirmedSnapshot(undefined);
    setStatus("Sampling storyboard visuals…");
    try {
      const attachments = await reviewImages(plan, references, signal);
      signal.throwIfAborted();
      if (latest.current !== snapshot) throw new Error("The storyboard changed. Review the current selection again.");
      setStatus("Waiting for the chat model…");
      const response = await complete(reviewInstruction, JSON.stringify({
        shots: plan.map(({ id, number, description, clip, offset, samples }) => ({
          id, number, description, timelineStart: offset,
          videoRange: clip.fileId ? { start: clip.start, end: clip.end } : undefined,
          samples,
        })),
      }), attachments, signal);
      signal.throwIfAborted();
      setResult({ ...parseReview(response, plan), snapshot });
      setTab("results");
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "Could not review these shots.");
    } finally {
      controller.current = null;
      if (!signal.aborted) setStatus("");
    }
  }

  function confirm(proposal: ReviewProposal) {
    if (stale || confirmedSnapshot || latest.current !== result?.snapshot) return;
    try {
      const next = applyReviewProposal(storyboard, proposal, images.length, crypto.randomUUID());
      onUpdate((current) => JSON.stringify(current) === boardSnapshot ? next : current);
      setConfirmedSnapshot(JSON.stringify(next));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply this proposal.");
    }
  }

  return (
    <>
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 gap-3">
        <TabsList aria-label="Review sections" className="shrink-0">
          <TabsTrigger value="selection">Selection</TabsTrigger>
          <TabsTrigger value="results" disabled={!result}>Results</TabsTrigger>
        </TabsList>
        <TabsContent value="selection" className="min-h-0 overflow-y-auto p-0.5">
          <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_13rem]">
            <section aria-label="Shots to review" className="min-w-0 space-y-3 rounded-2xl border bg-card p-3 text-card-foreground">
              <h3 className="flex items-center gap-2 text-sm font-medium"><FilmIcon aria-hidden="true" className="size-4 text-muted-foreground" />Shots to review</h3>
              {!shotOptions.length && <p className="text-sm text-muted-foreground">There are no shots available to review.</p>}
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
                {shotOptions.map(({ id, number, index, description, clip, picture, offset }) => {
                  const active = selected.has(id);
                  const caption = storyboard.shots?.[index]?.scene?.trim() || description;
                  const hasPicture = !!(picture.fileId || picture.url);
                  const media = clip.fileId ? "Video" : picture.fileId || picture.url ? "Still" : "Missing visual";
                  return <Button key={id} type="button" variant="ghost" disabled={!!status} aria-pressed={active}
                    aria-label={`Shot ${number}, ${media}`} title={description}
                    onClick={() => setSelected((current) => toggle(current, id, !current.has(id)))}
                    className={cn("relative aspect-video h-auto min-h-16 min-w-0 overflow-hidden rounded-lg border p-0 text-left",
                      active ? "border-ring ring-1 ring-ring" : "hover:border-ring/50")}>
                    <span className="absolute inset-0"><ReviewThumbnail picture={picture} /></span>
                    {hasPicture && <span aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-black/95 from-10% via-black/70 via-45% to-black/25" />}
                    <span className={cn("absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-xs font-medium", hasPicture ? "bg-black/75 text-white" : "bg-background")}>Shot {number}</span>
                    {active && <CheckIcon aria-hidden="true" className="absolute top-1.5 right-1.5 size-4 rounded-full bg-primary p-0.5 text-primary-foreground" />}
                    <span className={cn("absolute inset-x-1.5 bottom-1.5 block min-w-0 leading-tight", hasPicture && "text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]")}>
                      {caption && <span className="block truncate text-xs font-medium">{caption}</span>}
                      <span className={cn("block truncate text-xs tabular-nums", hasPicture ? "text-white/90" : "text-muted-foreground")}>{timestamp(offset)} · {media}</span>
                    </span>
                  </Button>;
                })}
              </div>
            </section>
            <section aria-label="Include references" className="min-w-0 space-y-2 rounded-2xl border bg-muted/25 p-3">
              <h3 className="text-sm font-medium">References</h3>
              {!referenceOptions.length && <p className="text-sm text-muted-foreground">{shots.length ? "No references for these shots." : "Select a shot to see its references."}</p>}
              <div className="grid min-w-0 grid-cols-1 gap-1.5 min-[480px]:grid-cols-2 md:grid-cols-1">
                {referenceOptions.map(({ key, name, ...picture }) => <Button key={key} type="button" variant="outline"
                  disabled={!!status} aria-pressed={approved.has(key)} aria-label={`Include ${name}`} title={name}
                  className="h-auto min-w-0 justify-start gap-2 rounded-lg px-1.5 py-1 aria-pressed:border-primary aria-pressed:bg-secondary"
                  onClick={() => setApproved((current) => toggle(current, key, !current.has(key)))}>
                  <span className="block aspect-video w-10 shrink-0 overflow-hidden rounded"><ReviewThumbnail picture={picture} /></span>
                  <span className="min-w-0 flex-1 truncate text-left text-xs">{name}</span>
                  {approved.has(key) && <CheckIcon aria-hidden="true" className="size-3.5" />}
                </Button>)}
              </div>
            </section>
          </div>
        </TabsContent>
        <TabsContent value="results" className="min-h-0 overflow-y-auto p-0.5">
          {result && <ReviewResults result={result} shots={shots} stale={stale} applied={applied}
            disabled={stale || !!confirmedSnapshot} onConfirm={confirm} />}
        </TabsContent>
      </Tabs>
      <div className="shrink-0 space-y-2 border-t pt-3">
        {(error || (tab === "selection" && (unavailableReason || overLimit))) && <p role="alert" className="wrap-anywhere text-xs text-destructive">
          {error || unavailableReason || `Select fewer shots or references to fit within ${reviewImageLimit} images.`}
        </p>}
        {!error && tab === "selection" && unavailableReason && !!visionModels?.length && onSelectModel && <div className="flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor="review-model" className="text-muted-foreground">Review with</label>
          <Select items={visionModels.map(({ id, name }) => ({ value: id, label: name }))} value={null} disabled={!!status}
            onValueChange={(value) => { if (value) onSelectModel(value); }}>
            <SelectTrigger id="review-model" size="sm" className="max-w-64 text-xs">
              <SelectValue placeholder="Choose a model that reads images" className="truncate" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {visionModels.map(({ id, name }) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>}
        <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between gap-2">
          {tab === "selection" ? <>
            <div className="min-w-0 space-y-1 text-xs tabular-nums text-muted-foreground">
              <p>{shots.length} {shots.length === 1 ? "shot" : "shots"} selected · {imageCount}/{reviewImageLimit} images</p>
              {status && <p role="status" className="flex items-center gap-1.5"><Loader2Icon aria-hidden="true" className="size-3 motion-safe:animate-spin" />{status}</p>}
            </div>
            <Button type="button" size="sm" disabled={!!status || !!unavailableReason || !plan} onClick={() => void review()}>
              <ScanEyeIcon data-icon="inline-start" />Review selection
            </Button>
          </> : (
            <Button type="button" size="sm" variant="outline" onClick={() => setTab("selection")}><ArrowLeftIcon data-icon="inline-start" />Edit selection</Button>
          )}
        </DialogFooter>
      </div>
    </>
  );
}

function ReviewThumbnail({ picture }: { picture: { url?: string; fileId?: string } }) {
  const src = picture.fileId ? `/api/storage/files/${encodeURIComponent(picture.fileId)}` : picture.url;
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" className="size-full object-cover" />
    : <span className="flex size-full items-center justify-center bg-muted text-muted-foreground"><ImageIcon aria-hidden="true" className="size-4" /></span>;
}

function ReviewResults({ result, shots, stale, applied, disabled, onConfirm }: {
  result: ReviewResult;
  shots: ReviewShots;
  stale: boolean;
  applied: boolean;
  disabled: boolean;
  onConfirm: (proposal: ReviewProposal) => void;
}) {
  const observations = [...result.observations].sort((left, right) => left.time - right.time);
  const shotNumber = (id: string) => stale ? undefined : shots.find((shot) => shot.id === id)?.number;
  return <section aria-label="Review results" className="min-w-0 space-y-3">
    {(applied || stale) && <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      {applied ? "Edit confirmed. Review again to get suggestions for the updated storyboard." : "The storyboard or selection changed. Review again to confirm edits."}
    </p>}
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      <section className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium">Observations</h3>
        {!observations.length && <p className="text-sm text-muted-foreground">No observations for these frames.</p>}
        <ol className="space-y-1.5">
          {observations.map(({ shotId, time, text }, index) => <li key={index} className="flex min-w-0 items-start gap-2.5 rounded-xl border p-2.5">
            <Badge variant="secondary" className="shrink-0 font-mono text-xs">{timestamp(time)}</Badge>
            <div className="min-w-0 space-y-0.5">
              {shotNumber(shotId) && <p className="text-xs font-medium text-muted-foreground">Shot {shotNumber(shotId)}</p>}
              <p className="wrap-anywhere text-sm">{text}</p>
            </div>
          </li>)}
        </ol>
      </section>
      <section className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium">Suggested edits</h3>
        {!result.proposals.length && <p className="text-sm text-muted-foreground">No edits suggested.</p>}
        {result.proposals.map((proposal, index) => {
          const trim = proposal.kind === "trim";
          const number = shotNumber(trim ? proposal.shotId : proposal.afterShotId);
          return <div key={index} className="min-w-0 space-y-2 rounded-xl border bg-muted/25 p-3">
            <div className="flex items-start gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
                {trim ? <ScissorsIcon aria-hidden="true" className="size-4" /> : <GitMergeIcon aria-hidden="true" className="size-4" />}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{trim ? "Short trim" : "Draft bridge shot"}</p>
                <p className="text-xs text-muted-foreground">
                  {number && `${trim ? "Shot" : "After shot"} ${number} · `}
                  {trim ? `${proposal.start}–${proposal.end}s in source clip` : `${proposal.seconds}s`}
                </p>
              </div>
            </div>
            {proposal.kind === "bridge" && <p className="wrap-anywhere text-sm">{proposal.description}</p>}
            <p className="wrap-anywhere text-sm text-muted-foreground">{proposal.reason}</p>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onConfirm(proposal)}>
              {trim ? "Confirm trim" : "Confirm draft bridge"}
            </Button>
          </div>;
        })}
      </section>
    </div>
    {!!result.discarded && <p role="status" className="text-xs text-muted-foreground">Skipped {result.discarded} invalid model {result.discarded === 1 ? "entry" : "entries"}.</p>}
  </section>;
}
