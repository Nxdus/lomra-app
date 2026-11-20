"use client";

import { Tip } from "@/components/tip";
import { SettingsIcon } from "lucide-react";
import { AboutSettings } from "@/components/about-settings";
import { AgentSettings } from "@/components/agent-settings";
import { ApiKeysPanel } from "@/components/api-settings";
import { OllamaSettings } from "@/components/ollama-settings";
import { SdSettings } from "@/components/sd-settings";
import { Local3dSettings } from "@/components/local3d-settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppUpdate } from "@/hooks/use-app-update";

const panelClassName = "-mx-3 min-h-0 overflow-y-auto overscroll-contain px-3 pb-5 sm:pb-6";

export function SettingsDialog() {
  const { info } = useAppUpdate();
  const updateAvailable = Boolean(info?.available);

  return <Dialog>
    <Tip label={updateAvailable ? "Settings · Update available" : "Settings"}><DialogTrigger render={<Button variant="outline" size="icon-lg" className="relative size-12 rounded-full bg-popover text-popover-foreground shadow-sm" />} aria-label={updateAvailable ? "Settings (update available)" : "Settings"}>
      <SettingsIcon />
      {updateAvailable && <span aria-hidden="true" className="absolute top-2.5 right-2.5 size-2 rounded-full bg-primary ring-2 ring-popover" />}
    </DialogTrigger></Tip>
    <DialogContent className="flex flex-col overflow-hidden rounded-3xl p-5 pb-0 sm:p-6 sm:pb-0">
      <DialogHeader className="shrink-0 gap-2 pr-8">
        <DialogTitle>Settings</DialogTitle>
      </DialogHeader>
      <Tabs defaultValue="api" className="min-h-0 gap-5">
        <TabsList className="w-full shrink-0">
          <TabsTrigger value="api">API keys</TabsTrigger>
          <TabsTrigger value="local">Local models</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="about">
            About
            {updateAvailable && <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="api" className={panelClassName}><ApiKeysPanel /></TabsContent>
        <TabsContent value="local" className={`${panelClassName} flex flex-col gap-5`}>
          <OllamaSettings />
          <Separator />
          <SdSettings />
          <Separator />
          <Local3dSettings />
        </TabsContent>
        <TabsContent value="agents" className={panelClassName}><AgentSettings /></TabsContent>
        <TabsContent value="about" className={panelClassName}>
          <AboutSettings />
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>;
}
