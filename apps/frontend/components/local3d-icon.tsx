import type { SVGProps } from "react";
import { HunyuanIcon } from "@/components/hunyuan-icon";
import { TripoIcon } from "@/components/tripo-icon";

/** The logo of the maker of a local 3D model, by model id (`hunyuan-2mini`, `triposr`). */
export function Local3dIcon({ id, ...props }: { id: string } & SVGProps<SVGSVGElement>) {
  return id.startsWith("triposr") ? <TripoIcon {...props} /> : <HunyuanIcon {...props} />;
}
