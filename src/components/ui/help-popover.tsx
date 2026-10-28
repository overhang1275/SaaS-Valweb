"use client";

import * as Popover from "@radix-ui/react-popover";
import { CircleHelp, X } from "lucide-react";
import type { ReactNode } from "react";

export function HelpPopover({ label, children }: { label: string; children: ReactNode }) {
  return <Popover.Root><Popover.Trigger asChild><button type="button" className="icon-button" aria-label={label}><CircleHelp size={18} aria-hidden="true" /></button></Popover.Trigger><Popover.Portal><Popover.Content aria-label={label} className="help-popover" sideOffset={8} collisionPadding={16}>
    <strong>{label}</strong><div>{children}</div><Popover.Close asChild><button className="icon-button popover-close" aria-label="Cerrar ayuda"><X size={16} /></button></Popover.Close><Popover.Arrow className="popover-arrow" />
  </Popover.Content></Popover.Portal></Popover.Root>;
}
