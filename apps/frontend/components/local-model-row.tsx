import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/tip";

type Action = { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean };

export function LocalModelRow({ name, description, size, status, action, secondary }: {
  name: string;
  description: string;
  size: string;
  status?: string;
  action?: Action;
  /** Shown before `action`. */
  secondary?: Action;
}) {
  return <div className="flex items-center gap-3 py-2.5 text-sm">
    <div className="min-w-0 flex-1">
      <div className="break-words">
        {name} <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{size}</span>
      </div>
      <div className="break-words text-xs text-muted-foreground">
        {description}{status && <> · <span role="status">{status}</span></>}
      </div>
    </div>
    <div className="flex h-8 min-w-8 shrink-0">
      {[secondary, action].map((item) => item && <Tip key={item.label} label={item.label}>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`${item.label} ${name}`} disabled={item.disabled} onClick={item.onClick}>
          {item.icon}
        </Button>
      </Tip>)}
    </div>
  </div>;
}
