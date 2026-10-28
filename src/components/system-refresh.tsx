"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function SystemRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") startTransition(() => router.refresh()); }, 10000);
    return () => clearInterval(timer);
  }, [router]);
  return <button className="button button-secondary" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw size={16} aria-hidden="true" />{pending ? "Comprobando…" : "Actualizar estado"}</button>;
}
