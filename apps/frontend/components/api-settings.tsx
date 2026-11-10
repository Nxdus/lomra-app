"use client";

import { ConfirmDelete } from "@/components/confirm-delete";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, DatabaseIcon, EyeIcon, EyeOffIcon, LoaderCircleIcon, PlugZapIcon, RefreshCwIcon, SaveIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { callProvider, useApiProviders, type Provider } from "@/components/api-provider";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type UsageResult = { metrics: { label: string; amount: number }[] };
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

function CreditUsage({ provider, apiKey }: { provider: Provider; apiKey: string }) {
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{
    refresh: number;
    metrics: UsageResult["metrics"];
  } | null>(null);
  const loading = result?.refresh !== refresh;

  useEffect(() => {
    let cancelled = false;
    const actions = provider === "fal" ? ["credits", "usage"] as const : ["usage"] as const;
    void Promise.allSettled(actions.map((action) => callProvider(provider, apiKey, { action }))).then((responses) => {
      if (cancelled) return;
      const metrics: UsageResult["metrics"] = [];
      const errors: string[] = [];
      responses.forEach((response) => {
        if (response.status === "fulfilled") metrics.push(...(response.value as UsageResult).metrics);
        else errors.push(response.reason instanceof Error ? response.reason.message : "Could not load credit usage");
      });
      [...new Set(errors)].forEach((title) => toast.add({ title, type: "error" }));
      setResult({ refresh, metrics });
    });
    return () => { cancelled = true; };
  }, [provider, apiKey, refresh]);

  return <section aria-label="Credit Usage" className="flex flex-col gap-1.5">
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium"><DatabaseIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />Credit Usage (USD)</h3>
    </div>
    <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
    <div role="status" aria-live="polite" aria-busy={loading} className="min-w-0 flex-1 text-xs">
      {loading ? <p className="text-muted-foreground">Loading credit usage…</p> : <>
        <dl className="flex divide-x divide-border empty:hidden">
          {result?.metrics.map((metric) => <div key={metric.label} className="min-w-0 flex-1 px-3 first:pl-0 last:pr-0">
            <dt className="text-xs text-muted-foreground">{metric.label}</dt>
            <dd className="text-xs tabular-nums">{usd.format(metric.amount)}</dd>
          </div>)}
        </dl>
      </>}
    </div>
    <Button type="button" variant="outline" size="icon-sm" className="rounded-lg" disabled={loading} aria-label={`Refresh ${provider === "fal" ? "Fal.AI" : "OpenRouter"} credit usage`} onClick={() => setRefresh((value) => value + 1)}>
      <RefreshCwIcon aria-hidden="true" />
    </Button>
    </div>
  </section>;
}

function ProviderSettings({ provider, name, href }: { provider: Provider; name: string; href: string }) {
  const { keys, setKey, keysReady } = useApiProviders();
  const [deletingKey, setDeletingKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftValue, setDraft] = useState<string | null>(null);
  const draft = draftValue ?? keys[provider];
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verification, setVerification] = useState<"idle" | "success" | "error">("idle");
  const revision = useRef(0);
  const saved = !!keys[provider] && draft.trim() === keys[provider];

  async function saveKey(value: string) {
    setSaving(true);
    try {
      await setKey(provider, value);
      setDraft(value.trim());
      toast.add({ title: value.trim() ? 'Saved to database' : 'Key removed', type: 'success' });
    } catch (error) {
      toast.add({ title: error instanceof Error ? error.message : 'Could not save key', type: 'error' });
    } finally { setSaving(false); }
  }

  async function verify() {
    const version = ++revision.current;
    setChecking(true);
    setVerification("idle");
    try {
      await callProvider(provider, draft.trim(), { action: "verify" });
      if (version === revision.current) {
        setVerification("success");
        toast.add({ title: "Connection verified for this key.", type: "success" });
      }
    } catch (error) {
      if (version === revision.current) {
        setVerification("error");
        toast.add({ title: error instanceof Error ? error.message : "Connection failed", type: "error" });
      }
    } finally {
      if (version === revision.current) setChecking(false);
    }
  }

  return <section aria-labelledby={`${provider}-heading`} className="flex flex-col gap-4">
    <ConfirmDelete open={deletingKey} onOpenChange={setDeletingKey} title={`Remove ${name} API key?`} description="You will need to add a key again to use this provider." disabled={!keysReady || saving} onConfirm={async () => {
        revision.current++;
        setChecking(false);
        await saveKey("");
        setVisible(false);
        setVerification("idle");
      }} />
    <div className="flex items-center justify-between gap-2">
      <h2 id={`${provider}-heading`} className="text-sm font-medium">{name}</h2>
      <a href={href} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Get API key
      </a>
    </div>
    {!keysReady ? <div role="status" aria-label={`Loading ${name} settings`} aria-busy="true" className="flex flex-col gap-3">
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-11 w-full" />
        <div className="flex items-center justify-end gap-2">
          <Skeleton className="size-8" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
    </div> : <>
    {saved && <CreditUsage key={keys[provider]} provider={provider} apiKey={keys[provider]} />}
    <Field className="gap-3" data-invalid={verification === "error" || undefined}>
    <FieldLabel htmlFor={`${provider}-key`} className="items-center gap-1.5 text-xs font-medium"><DatabaseIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />API Key</FieldLabel>
    <InputGroup className="h-11">
    <InputGroupInput id={`${provider}-key`} type={visible ? "text" : "password"} value={draft}
      autoComplete="off" spellCheck={false} maxLength={512} disabled={!keysReady || saving}
      placeholder="Paste your API key"
      aria-invalid={verification === "error"}
      aria-describedby={`${provider}-status`}
      onChange={(event) => {
        revision.current++;
        setChecking(false);
        setDraft(event.target.value);
        setVerification("idle");
      }} />
    <InputGroupAddon align="inline-end">
      <InputGroupButton size="icon-sm" onClick={() => setVisible(!visible)} aria-pressed={visible} aria-label={`${visible ? "Hide" : "Show"} ${name} API key`}>
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </InputGroupButton>
    </InputGroupAddon>
    </InputGroup>
    <div className="flex flex-wrap items-center gap-2">
      {(draft || keys[provider]) && <Button type="button" variant="destructive" size="icon-sm" disabled={!keysReady || saving} aria-label={`Remove ${name} API key`} title={`Remove ${name} API key`} onClick={() => setDeletingKey(true)}><Trash2Icon aria-hidden="true" /></Button>}
      <div className="ml-auto flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="icon-sm" disabled={!draft.trim() || checking} aria-label={checking ? `Checking ${name} connection` : `Test ${name} connection`} title={checking ? "Checking…" : "Test connection"} onClick={verify}>
        {checking ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" /> : <PlugZapIcon aria-hidden="true" />}
      </Button>
      <Button type="button" size="sm" disabled={!keysReady || saving || !draft.trim() || saved} onClick={() => void saveKey(draft)}>{saved ? <CheckIcon aria-hidden="true" data-icon="inline-start" /> : <SaveIcon aria-hidden="true" data-icon="inline-start" />}{saving ? "Saving…" : saved ? "Saved" : "Save key"}</Button>
      </div>
    </div>
    <div id={`${provider}-status`} role="status" className="text-xs text-muted-foreground empty:hidden">
      {checking ? "Testing connection…" : !saved && keys[provider] ? "Unsaved changes" : ""}
    </div>
    </Field>
    </>}
  </section>;
}

export function ApiSettings() {
  return <Dialog>
    <DialogTrigger render={<Button variant="outline" size="icon-lg" className="size-12 rounded-full bg-popover text-popover-foreground shadow-sm" />} aria-label="Settings" title="Settings">
      <SettingsIcon />
    </DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl p-5 sm:p-6">
      <DialogHeader className="gap-2 pr-8">
        <DialogTitle>API Settings</DialogTitle>
      </DialogHeader>
      <FieldGroup className="gap-6">
        <ProviderSettings provider="openrouter" name="OpenRouter" href="https://openrouter.ai/settings/keys" />
        <Separator />
        <ProviderSettings provider="fal" name="Fal.AI" href="https://fal.ai/dashboard/keys" />
      </FieldGroup>
    </DialogContent>
  </Dialog>;
}
