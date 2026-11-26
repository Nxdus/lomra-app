"use client";

import { Tip } from "@/components/tip";
import { ConfirmDelete } from "@/components/confirm-delete";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, DatabaseIcon, EyeIcon, EyeOffIcon, LoaderCircleIcon, PlugZapIcon, RefreshCwIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { callProvider, useApiProviders, type KeyedProvider as Provider } from "@/components/api-provider";
import { readGoogleUsage, type GoogleUsage } from "@/components/google-usage";
import { toast } from "@/components/ui/toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";

type UsageResult = { metrics: { label: string; amount: number }[] };
const creditCache = new Map<string, { apiKey: string; at: number; metrics: UsageResult["metrics"] }>();
const creditCacheTtl = 60_000;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

const tokens = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function GoogleUsageBox() {
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ refresh: number; usage: GoogleUsage | null; failed?: boolean }>();
  const loading = result?.refresh !== refresh;
  const usage = result?.usage;
  useEffect(() => {
    let cancelled = false;
    void readGoogleUsage().then(
      (usage) => { if (!cancelled) setResult({ refresh, usage }); },
      () => { if (!cancelled) setResult((last) => ({ refresh, usage: last?.usage ?? null, failed: true })); },
    );
    return () => { cancelled = true; };
  }, [refresh]);
  return <section aria-label="Google usage" className="flex flex-col gap-1.5">
    <h3 className="flex items-center gap-1.5 text-xs font-medium"><DatabaseIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />Usage · This month</h3>
    <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5">
      <div role="status" aria-busy={loading} className="min-w-0 flex-1 text-xs">
      {loading ? <p className="text-muted-foreground">Loading Google usage…</p> : usage && <dl className="flex divide-x divide-border">
        <div className="min-w-0 flex-1 px-3 first:pl-0"><dt className="text-muted-foreground">Requests</dt><dd className="tabular-nums">{usage?.requests ?? "…"}</dd></div>
        <div className="min-w-0 flex-1 px-3"><dt className="text-muted-foreground">Tokens in</dt><dd className="tabular-nums">{usage ? tokens.format(usage.inputTokens) : "…"}</dd></div>
        <div className="min-w-0 flex-1 px-3 last:pr-0"><dt className="text-muted-foreground">Tokens out</dt><dd className="tabular-nums">{usage ? tokens.format(usage.outputTokens) : "…"}</dd></div>
      </dl>}
      </div>
      <Tip label="Refresh Google usage"><Button type="button" variant="outline" size="icon-sm" className="rounded-lg" disabled={loading} aria-label="Refresh Google usage" onClick={() => setRefresh((value) => value + 1)}><RefreshCwIcon aria-hidden="true" /></Button></Tip>
    </div>
    {!loading && result?.failed && <Alert variant="destructive"><AlertDescription>Could not load Google usage.{usage ? " Showing the last available totals." : ""} Use Refresh to try again.</AlertDescription></Alert>}
  </section>;
}

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
    const force = refresh > 0;
    void Promise.allSettled(actions.map(async (action) => {
      const cacheKey = `${provider}:${action}`;
      const cached = creditCache.get(cacheKey);
      const last = cached?.apiKey === apiKey ? cached : undefined;
      if (last && !force && Date.now() - last.at < creditCacheTtl) return { metrics: last.metrics };
      try {
        const metrics = ((await callProvider(provider, apiKey, { action })) as UsageResult).metrics;
        creditCache.set(cacheKey, { apiKey, at: Date.now(), metrics });
        return { metrics };
      } catch (error) {
        // Keep showing the last good value; only surface the error when the user asked to refresh.
        const message = error instanceof Error ? error.message : "Could not load credit usage";
        if (last) return { metrics: last.metrics, error: force ? message : undefined };
        throw new Error(message);
      }
    })).then((responses) => {
      if (cancelled) return;
      const metrics: UsageResult["metrics"] = [];
      const errors: string[] = [];
      responses.forEach((response) => {
        if (response.status === "rejected") errors.push(response.reason instanceof Error ? response.reason.message : "Could not load credit usage");
        else {
          metrics.push(...response.value.metrics);
          if (response.value.error) errors.push(response.value.error);
        }
      });
      [...new Set(errors)].forEach((title) => toast.add({ title, type: "error" }));
      setResult({ refresh, metrics });
    });
    return () => { cancelled = true; };
  }, [provider, apiKey, refresh]);

  return <section aria-label="Credit usage" className="flex flex-col gap-1.5">
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium"><DatabaseIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />Credit usage (USD)</h3>
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
    <Tip label="Refresh credit usage"><Button type="button" variant="outline" size="icon-sm" className="rounded-lg" disabled={loading} aria-label={`Refresh ${provider === "fal" ? "Fal.AI" : "OpenRouter"} credit usage`} onClick={() => setRefresh((value) => value + 1)}>
      <RefreshCwIcon aria-hidden="true" />
    </Button></Tip>
    </div>
  </section>;
}

function ProviderSettings({
  provider,
  name,
  href,
  targetProvider,
  onVerified,
  onKeyChange,
}: {
  provider: Provider;
  name: string;
  href: string;
  targetProvider?: Provider | null;
  onVerified?: () => void;
  onKeyChange?: () => void;
}) {
  const { keys, setKey, keysReady } = useApiProviders();
  const [deletingKey, setDeletingKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftValue, setDraft] = useState<string | null>(null);
  const draft = draftValue ?? keys[provider];
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [verification, setVerification] = useState<"idle" | "success" | "error">("idle");
  const revision = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const isTarget = targetProvider === provider;
  const saved = !!keys[provider] && draft.trim() === keys[provider];

  useEffect(() => {
    if (isTarget && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isTarget]);

  async function saveKey(value: string) {
    setSaving(true);
    try {
      await setKey(provider, value);
      setDraft(value.trim());
      onKeyChange?.();
      toast.add({ title: value.trim() ? 'API key saved' : 'Key removed', type: 'success' });
    } catch (error) {
      toast.add({ title: error instanceof Error ? error.message : 'Could not save key', type: 'error' });
    } finally { setSaving(false); }
  }

  async function verify() {
    const version = ++revision.current;
    setChecking(true);
    setVerification("idle");
    setVerificationError("");
    try {
      const result = await callProvider(provider, draft.trim(), { action: "verify" }) as { connected?: boolean };
      if (!result?.connected) throw new Error("Connection failed.");
      if (version === revision.current) {
        setVerification("success");
        onVerified?.();

      }
    } catch (error) {
      if (version === revision.current) {
        setVerification("error");
        setVerificationError(error instanceof Error ? error.message : "Connection failed.");
      }
    } finally {
      if (version === revision.current) setChecking(false);
    }
  }

  return <section aria-labelledby={`${provider}-heading`} className="flex flex-col gap-3">
    <ConfirmDelete open={deletingKey} onOpenChange={setDeletingKey} title={`Remove ${name} API key?`} description="You will need to add a key again to use this provider." actionLabel="Remove" disabled={!keysReady || saving} onConfirm={async () => {
        revision.current++;
        setChecking(false);
        await setKey(provider, "");
        setDraft("");
        onKeyChange?.();
        toast.add({ title: "Key removed", type: "success" });
        setVisible(false);
        setVerification("idle");
      }} />
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h2 id={`${provider}-heading`} className="text-sm font-medium">{name}</h2>
        {isTarget && (
          <Badge>Required</Badge>
        )}
      </div>
      <a href={href} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
        Get API key
      </a>
    </div>
    {!keysReady ? <div role="status" aria-label={`Loading ${name} settings`} aria-busy="true" className="flex flex-col gap-3">
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-full" />
        <div className="flex items-center justify-end gap-2">
          <Skeleton className="size-8" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
    </div> : <>
    {saved && (provider === "google" ? <GoogleUsageBox /> : <CreditUsage key={keys[provider]} provider={provider} apiKey={keys[provider]} />)}
    <Field className="gap-2" data-invalid={verification === "error" || undefined}>
    <FieldLabel htmlFor={`${provider}-key`} className="items-center gap-1.5 text-xs font-medium"><DatabaseIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />API key</FieldLabel>
    <InputGroup className="h-10">
    <InputGroupInput ref={inputRef} id={`${provider}-key`} type={visible ? "text" : "password"} value={draft}
      autoComplete="off" spellCheck={false} maxLength={512} disabled={!keysReady || saving}
      placeholder="Paste your API key"
      aria-invalid={verification === "error"}
      aria-describedby={`${provider}-status`}
      onChange={(event) => {
        revision.current++;
        setChecking(false);
        setDraft(event.target.value);
        setVerification("idle");
        onKeyChange?.();
      }} />
    <InputGroupAddon align="inline-end">
      <Tip label={visible ? "Hide API key" : "Show API key"}><InputGroupButton size="icon-sm" onClick={() => setVisible(!visible)} aria-pressed={visible} aria-label={`${visible ? "Hide" : "Show"} ${name} API key`}>
        {visible ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
      </InputGroupButton></Tip>
    </InputGroupAddon>
    </InputGroup>
    <div className="flex flex-wrap items-center gap-2">
      {(draft || keys[provider]) && <Tip label={`Remove ${name} API key`}><Button type="button" variant="destructive" size="icon-sm" disabled={!keysReady || saving} aria-label={`Remove ${name} API key`} onClick={() => setDeletingKey(true)}><Trash2Icon aria-hidden="true" /></Button></Tip>}
      <div className="ml-auto flex flex-wrap gap-2">
      <Tip label={checking ? "Checking…" : "Test connection"}><Button type="button" variant="outline" size="icon-sm" disabled={!draft.trim() || checking} aria-label={checking ? `Checking ${name} connection` : `Test ${name} connection`} onClick={verify}>
        {checking ? <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" /> : <PlugZapIcon aria-hidden="true" />}
      </Button></Tip>
      <Button type="button" size="sm" disabled={!keysReady || saving || !draft.trim() || saved} onClick={() => void saveKey(draft)}>{saved ? <CheckIcon aria-hidden="true" data-icon="inline-start" /> : <SaveIcon aria-hidden="true" data-icon="inline-start" />}{saving ? "Saving…" : saved ? "Saved" : "Save key"}</Button>
      </div>
    </div>
    <div id={`${provider}-status`} role="status" className="text-xs text-muted-foreground empty:hidden">
      {checking ? "Testing connection…" : verification === "success" ? "Connection verified for this key." : !saved && keys[provider] ? "Unsaved changes" : ""}
      {verification === "error" && <FieldError>{verificationError}</FieldError>}
    </div>
    </Field>
    </>}
  </section>;
}

export function ApiKeysPanel({
  targetProvider,
  onVerified,
  onKeyChange,
}: {
  targetProvider?: Provider | null;
  onVerified?: () => void;
  onKeyChange?: () => void;
} = {}) {
  const { storageError, retryKeys } = useApiProviders();
  if (storageError) return <Alert variant="destructive">
    <AlertDescription>{storageError}</AlertDescription>
    <Button variant="outline" size="sm" className="mt-2 w-fit" onClick={retryKeys}>Retry</Button>
  </Alert>;
  return <FieldGroup className="gap-4">
    <ProviderSettings provider="openrouter" name="OpenRouter" href="https://openrouter.ai/settings/keys" targetProvider={targetProvider} onVerified={onVerified} onKeyChange={onKeyChange} />
    <Separator />
    <ProviderSettings provider="fal" name="Fal.AI" href="https://fal.ai/dashboard/keys" targetProvider={targetProvider} onVerified={onVerified} onKeyChange={onKeyChange} />
    <Separator />
    <ProviderSettings provider="google" name="Google AI" href="https://aistudio.google.com/apikey" targetProvider={targetProvider} onVerified={onVerified} onKeyChange={onKeyChange} />
  </FieldGroup>;
}
