import type { ReactElement, ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function Tip({ label, children }: { label: ReactNode; children: ReactElement<{ children?: ReactNode }> }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children}>{children.props.children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
