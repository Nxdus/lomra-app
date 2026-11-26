"use client";

import { RefreshCwIcon } from "lucide-react";
import { Tip } from "@/components/tip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { useAppUpdate } from "@/hooks/use-app-update";

/** Slim pinned footer in Settings: desktop version, update status/action, and manual refresh. */
export function AppVersionFooter() {
  const { version, info, checking, status, progress, error, check, install, cancel, openRelease } = useAppUpdate();

  if (version === null) return null;

  async function openUrl(url: string) {
    if (!await openRelease(url)) {
      toast.add({ title: "Could not open release link", type: "error" });
    }
  }

  const displayVersion = (version ?? info?.current ?? "").replace(/^v/i, "");
  const downloadUrl = info?.assetUrl ?? info?.url;
  const upToDate = Boolean(info && !info.error && !info.available);
  const totalBytes = progress?.total || info?.assetSize || 0;
  const receivedBytes = progress?.received ?? 0;
  const percent = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null;
  const busy = checking || status === "downloading" || status === "installing" || version === undefined;

  return (
    <footer className="flex shrink-0 items-center justify-between gap-2 border-t py-3 text-xs text-muted-foreground">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {version === undefined ? (
          <>
            <span>Lomra</span>
            <Skeleton className="h-3 w-20" />
          </>
        ) : status === "installing" ? (
          <span role="status" aria-live="polite" className="truncate">
            Installing… Lomra will restart
          </span>
        ) : status === "downloading" ? (
          <>
            <span role="status" className="truncate tabular-nums">
              Downloading v{info?.latest ?? ""}…{percent !== null ? ` ${percent}%` : ""}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-auto px-1.5 py-0.5 text-xs"
              onClick={() => void cancel()}
            >
              Cancel
            </Button>
          </>
        ) : status === "error" && error ? (
          <>
            <span className="truncate text-destructive" title={error}>
              {error}
            </span>
            <Button type="button" variant="outline" size="xs" onClick={() => void install()}>
              Retry
            </Button>
          </>
        ) : info?.error ? (
          <>
            <span className="truncate text-destructive" title={info.error}>
              {info.error}
            </span>
            <Button type="button" variant="outline" size="xs" onClick={() => void check(true)}>
              Retry
            </Button>
          </>
        ) : info?.available && info.latest ? (
          <>
            <span className="truncate">
              Lomra v{displayVersion} · v{info.latest} available
            </span>
            {info.canInstall ? (
              <Button type="button" size="xs" onClick={() => void install()}>
                Update
              </Button>
            ) : downloadUrl ? (
              <Button type="button" size="xs" onClick={() => void openUrl(downloadUrl)}>
                Download
              </Button>
            ) : null}
            {info.url && (
              <a
                href={info.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(info.url!);
                }}
                className="shrink-0 underline underline-offset-4 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Release notes
              </a>
            )}
          </>
        ) : upToDate ? (
          <span className="truncate">Lomra v{displayVersion} · Up to date</span>
        ) : (
          <span className="truncate">Lomra v{displayVersion}</span>
        )}
      </div>

      <Tip label="Check for updates">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Check for updates"
          disabled={busy}
          onClick={() => void check(true)}
        >
          <RefreshCwIcon aria-hidden="true" className={checking ? "motion-safe:animate-spin" : undefined} />
        </Button>
      </Tip>
    </footer>
  );
}
