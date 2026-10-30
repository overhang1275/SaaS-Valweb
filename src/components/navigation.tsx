"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Building2, Users, ClipboardCheck, Settings, ChartNoAxesCombined } from "lucide-react";

export function Navigation({ admin, onNavigate }: { admin: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const links = [
    { href: "/dashboard", label: "Resumen", Icon: LayoutDashboard },
    { href: "/validaciones", label: "Validaciones", Icon: ClipboardCheck },
    { href: "/estadisticas", label: "Estadísticas", Icon: ChartNoAxesCombined },
    ...(admin ? [{ href: "/admin/clientes", label: "Clientes", Icon: Building2 }] : []),
    { href: "/admin/usuarios", label: admin ? "Usuarios" : "Usuarios de consulta", Icon: Users },
    ...(admin ? [{ href: "/admin/ajustes", label: "Ajustes generales", Icon: Settings }] : []),
  ];
  return <nav aria-label="Principal">{links.map(({ href, label, Icon }) => {
    const selected = pathname === href || pathname.startsWith(`${href}/`);
    return <Link key={href} href={href} onClick={onNavigate} className={selected ? "nav-link selected" : "nav-link"} aria-current={selected ? "page" : undefined}><Icon size={19} aria-hidden="true" />{label}</Link>;
  })}</nav>;
}
