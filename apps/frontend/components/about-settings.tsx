"use client";

import { DownloadIcon, ExternalLinkIcon, InfoIcon, LoaderCircleIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useAppUpdate } from "@/hooks/use-app-update";

function excerpt(notes: string | undefined, max = 280) {
  const trimmed = notes?.trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

function formatBytes(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

/** Settings → About: running desktop app version and GitHub Releases update check. */
export function AboutSettings() {
  const { version, info, checking, status, progress, error, check, install, cancel, openRelease } = useAppUpdate();

  async function openUrl(url: string) {
    if (!await openRelease(url)) {
      toast.add({ title: "Could not open release link", type: "error" });
    }
  }

  const displayVersion = (version ?? info?.current ?? "").replace(/^v/i, "");
  const downloadUrl = info?.assetUrl ?? info?.url;
  const notesExcerpt = excerpt(info?.notes);
  const upToDate = Boolean(info && !info.error && !info.available);
  const totalBytes = progress?.total || info?.assetSize || 0;
  const receivedBytes = progress?.received ?? 0;
  const percent = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null;

  return <section aria-labelledby="about-heading" className="flex flex-col gap-4">
    <div className="flex items-center gap-3">
      <InfoIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="about-heading" className="text-sm font-semibold">
            {displayVersion ? `Lomra v${displayVersion}` : "Lomra"}
          </h2>
          {info?.available && info.latest && <Badge>v{info.latest} available</Badge>}
          {upToDate && <Badge variant="secondary">Up to date</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">Desktop version and GitHub releases</p>
      </div>
      {version !== null && version !== undefined && (
        <Button type="button" variant="outline" size="sm" disabled={checking || status === "downloading" || status === "installing"} onClick={() => void check(true)}>
          <RefreshCwIcon aria-hidden="true" data-icon="inline-start" className={checking ? "animate-spin" : undefined} />
          {checking ? "Checking…" : "Check for updates"}
        </Button>
      )}
    </div>

    {version === undefined ? (
      <div role="status" aria-label="Loading version info" aria-busy="true" className="flex flex-col gap-2">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    ) : version === null ? (
      <p className="text-xs text-muted-foreground">
        Version and update checks require the Lomra desktop app.
      </p>
    ) : info?.error ? (
      <Alert variant="destructive">
        <AlertTitle>Could not check for updates</AlertTitle>
        <AlertDescription>{info.error}</AlertDescription>
      </Alert>
    ) : info?.available && info.latest ? (
      <div className="flex flex-col gap-3 rounded-xl bg-muted/60 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium">Lomra v{info.latest} is available</p>
          {info.publishedAt && (
            <span className="text-xs text-muted-foreground">
              {new Date(info.publishedAt).toLocaleDateString()}
            </span>
          )}
        </div>
        {notesExcerpt && (
          <p className="text-xs whitespace-pre-wrap text-muted-foreground">{notesExcerpt}</p>
        )}

        {status === "downloading" ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                Downloading update… {formatBytes(receivedBytes)}
                {totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ""}
              </span>
              {percent !== null && <span className="tabular-nums">{percent}%</span>}
            </div>
            <Progress value={percent} aria-label={`Downloading Lomra v${info.latest}`} className="[&_[data-slot=progress-track]]:h-1.5" />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => void cancel()}>
                <XIcon aria-hidden="true" data-icon="inline-start" />
                Cancel
              </Button>
              {info.url && (
                <a
                  href={info.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    void openUrl(info.url!);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Release notes
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                </a>
              )}
            </div>
          </div>
        ) : status === "installing" ? (
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs font-medium">
              <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
              <span>Installing… Lomra will restart</span>
            </div>
            <Progress value={null} aria-label="Installing update" className="[&_[data-slot=progress-track]]:h-1.5" />
            {info.url && (
              <div>
                <a
                  href={info.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    void openUrl(info.url!);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Release notes
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                </a>
              </div>
            )}
          </div>
        ) : (
          <>
            {status === "error" && error && (
              <Alert variant="destructive">
                <AlertTitle>Update failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {info.canInstall ? (
                <Button type="button" size="sm" onClick={() => void install()}>
                  <DownloadIcon aria-hidden="true" data-icon="inline-start" />
                  Update now
                </Button>
              ) : downloadUrl && (
                <Button type="button" size="sm" onClick={() => void openUrl(downloadUrl)}>
                  <DownloadIcon aria-hidden="true" data-icon="inline-start" />
                  Download v{info.latest}
                </Button>
              )}
              {info.url && (
                <a
                  href={info.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => {
                    event.preventDefault();
                    void openUrl(info.url!);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Release notes
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                </a>
              )}
            </div>
          </>
        )}
      </div>
    ) : upToDate ? (
      <div role="status" className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>You are running the latest version{info?.latest ? ` (v${info.latest})` : ""}.</span>
        {info?.url && (
          <a
            href={info.url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              void openUrl(info.url!);
            }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Release notes
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
          </a>
        )}
      </div>
    ) : (
      <p role="status" className="text-xs text-muted-foreground">
        {checking ? "Checking for updates…" : "Check GitHub Releases for newer versions."}
      </p>
    )}
  </section>;
}
