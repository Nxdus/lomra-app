import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/tip";

export function LocalModelRow({ name, description, size, status, action }: {
  name: string;
  description: string;
  size: string;
  status?: string;
  action?: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean };
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
    <div className="size-8 shrink-0">
      {action && <Tip label={action.label}>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`${action.label} ${name}`} disabled={action.disabled} onClick={action.onClick}>
          {action.icon}
        </Button>
      </Tip>}
    </div>
  </div>;
}
