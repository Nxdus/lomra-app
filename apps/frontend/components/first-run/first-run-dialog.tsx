"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function FirstRunDialog({ open, onStartBlank, onStartTutorial }: {
  open: boolean;
  onStartBlank: () => void;
  onStartTutorial: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onStartBlank(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to Lomra</DialogTitle>
          <DialogDescription>
            Set up an API provider or install a local model to start the tutorial with a sample project.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onStartBlank}>Start with blank canvas</Button>
          <Button type="button" onClick={onStartTutorial}>Start tutorial</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
