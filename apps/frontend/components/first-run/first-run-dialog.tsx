"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowRightIcon, FolderOpenIcon, SquarePlusIcon } from "lucide-react";

export function FirstRunDialog({ open, onStartBlank, onStartTutorial }: {
  open: boolean;
  onStartBlank: () => void;
  onStartTutorial: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onStartBlank(); }}>
      <DialogContent className="max-w-md gap-5 rounded-3xl p-6 shadow-2xl">
        <DialogHeader className="gap-2 pr-6">
          <DialogTitle>Welcome to Lomra</DialogTitle>
          <DialogDescription className="text-xs">
            A local-first creative canvas for images, video, and 3D.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Button type="button" variant="outline" onClick={onStartTutorial}
            className="h-auto justify-start gap-3.5 rounded-2xl border-primary/20 bg-primary/5 p-4 text-left whitespace-normal hover:border-primary/40 hover:bg-primary/10">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FolderOpenIcon aria-hidden="true" className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span>Start tutorial</span>
              <span className="text-xs font-normal text-muted-foreground">Set up a provider, then follow along with a sample project.</span>
            </span>
            <ArrowRightIcon aria-hidden="true" className="text-muted-foreground" />
          </Button>
          <Button type="button" variant="outline" onClick={onStartBlank}
            className="h-auto justify-start gap-3.5 rounded-2xl bg-card p-4 text-left whitespace-normal">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <SquarePlusIcon aria-hidden="true" className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span>Start with blank canvas</span>
              <span className="text-xs font-normal text-muted-foreground">Open an empty canvas and set up models later.</span>
            </span>
            <ArrowRightIcon aria-hidden="true" className="text-muted-foreground" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
