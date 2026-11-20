"use client";

import { useEffect, useRef } from "react";
import { MinusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ToastDescription, ToastTitle, toast } from "@/components/ui/toast";
import { useAppUpdate, type AppUpdateStatus } from "@/hooks/use-app-update";
import type { UpdateInfo } from "@/lib/desktop";

function ReleaseNotesLink({ url, onOpen }: { url: string; onOpen: (url: string) => void }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => {
        event.preventDefault();
        onOpen(url);
      }}
      className="w-fit text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
    >
      Release notes
    </a>
  );
}

function UpdateToastBody({
  info,
  status,
  progress,
  error,
  onInstall,
  onCancel,
  onDismiss,
  onMinimize,
  onOpenRelease,
}: {
  info: UpdateInfo;
  status: AppUpdateStatus;
  progress: { received: number; total: number } | null;
  error: string | null;
  onInstall: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  onMinimize: () => void;
  onOpenRelease: (url: string) => void;
}) {
  const latest = info.latest ?? "";
  const total = progress?.total || info.assetSize || 0;
  const received = progress?.received ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
  const downloadUrl = info.assetUrl ?? info.url;

  if (status === "downloading") {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <ToastTitle className="font-semibold">Downloading Update</ToastTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Minimize update notification"
            className="-mt-1 -mr-1 text-muted-foreground hover:text-foreground"
            onClick={onMinimize}
          >
            <MinusIcon aria-hidden="true" />
          </Button>
        </div>
        <ToastDescription>Lomra v{latest} is downloading.</ToastDescription>
        {info.url && <ReleaseNotesLink url={info.url} onOpen={onOpenRelease} />}
        <Progress
          value={percent}
          aria-label={`Downloading Lomra v${latest}`}
          className="pt-0.5 [&_[data-slot=progress-track]]:h-1.5"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {percent !== null ? `Downloading... ${percent}%` : "Downloading..."}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (status === "installing") {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <ToastTitle className="font-semibold">Installing update</ToastTitle>
        <ToastDescription>Lomra will restart in a moment.</ToastDescription>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-col gap-1">
          <ToastTitle className="font-semibold">Update failed</ToastTitle>
          <ToastDescription>{error ?? "Could not install the update."}</ToastDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="xs" onClick={onInstall}>
            Retry
          </Button>
          <Button type="button" variant="outline" size="xs" onClick={onDismiss}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <ToastTitle className="font-semibold">Update available</ToastTitle>
        <ToastDescription>Lomra v{latest} is available.</ToastDescription>
      </div>
      {info.url && <ReleaseNotesLink url={info.url} onOpen={onOpenRelease} />}
      <div className="flex flex-wrap items-center gap-2">
        {info.canInstall ? (
          <Button type="button" size="xs" onClick={onInstall}>
            Update
          </Button>
        ) : downloadUrl ? (
          <Button type="button" size="xs" onClick={() => onOpenRelease(downloadUrl)}>
            Download
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="xs" onClick={onDismiss}>
          Later
        </Button>
      </div>
    </div>
  );
}

/** Persistent desktop-only toast controller for app updates; renders no DOM of its own. */
export function UpdateToast() {
  const { version, info, status, progress, error, dismissed, minimized, install, cancel, dismiss, minimize, openRelease } = useAppUpdate();
  const toastIdRef = useRef<string | null>(null);
  const closingIdsRef = useRef(new Set<string>());
  const statusRef = useRef(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const hasUpdate = Boolean(version !== null && version !== undefined && info?.available && info.latest);
  const shouldShow =
    hasUpdate &&
    (status === "installing" ||
      status === "error" ||
      (status === "downloading" && !minimized) ||
      (status === "idle" && !dismissed));

  useEffect(() => {
    if (!shouldShow || !info?.latest) {
      const id = toastIdRef.current;
      if (id) {
        toastIdRef.current = null;
        closingIdsRef.current.add(id);
        toast.close(id);
      }
      return;
    }

    const handleOpenRelease = (url: string) => {
      void openRelease(url).then((ok) => {
        if (!ok) toast.add({ title: "Could not open release link", type: "error" });
      });
    };

    const title =
      status === "downloading" ? "Downloading Update"
      : status === "installing" ? "Installing update"
      : status === "error" ? "Update failed"
      : "Update available";

    const description =
      status === "downloading" ? `Lomra v${info.latest} is downloading.`
      : status === "installing" ? "Lomra will restart in a moment."
      : status === "error" ? (error ?? "Could not install the update.")
      : `Lomra v${info.latest} is available.`;

    const renderBody = () => (
      <UpdateToastBody
        info={info}
        status={status}
        progress={progress}
        error={error}
        onInstall={() => void install()}
        onCancel={() => void cancel()}
        onDismiss={dismiss}
        onMinimize={minimize}
        onOpenRelease={handleOpenRelease}
      />
    );

    if (!toastIdRef.current) {
      let createdId = "";
      createdId = toast.add({
        title,
        description,
        timeout: 0,
        priority: status === "error" ? "high" : "low",
        data: { render: renderBody },
        onClose: () => {
          if (closingIdsRef.current.has(createdId)) return;
          if (toastIdRef.current === createdId) toastIdRef.current = null;
          if (statusRef.current === "downloading") minimize();
          else dismiss();
        },
        onRemove: () => {
          closingIdsRef.current.delete(createdId);
          if (toastIdRef.current === createdId) toastIdRef.current = null;
        },
      });
      toastIdRef.current = createdId;
    } else {
      toast.update(toastIdRef.current, {
        title,
        description,
        timeout: 0,
        data: { render: renderBody },
      });
    }
  }, [shouldShow, info, status, progress, error, install, cancel, dismiss, minimize, openRelease]);

  useEffect(() => {
    const closingIds = closingIdsRef.current;
    return () => {
      const id = toastIdRef.current;
      if (id) {
        toastIdRef.current = null;
        closingIds.add(id);
        toast.close(id);
      }
    };
  }, []);

  return null;
}
