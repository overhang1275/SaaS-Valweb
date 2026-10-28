import { Brand } from "@/components/brand";
import { Navigation } from "@/components/navigation";
import { LogoutButton } from "@/components/logout-button";
import { MobileNavigation } from "@/components/mobile-navigation";
import { requireActor } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ShieldCheck } from "lucide-react";
import Image from "next/image";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true, email: true, tenant: { select: { name: true } } } });
  const workspace = actor.role === "ADMIN" ? "Administración" : user.tenant?.name ?? "Tu cuenta";
  return <div className="app-shell"><aside className="sidebar"><Brand /><div className="workspace-identity"><span className="workspace-monogram">{workspace.slice(0, 1).toUpperCase()}</span><div><span>Espacio de trabajo</span><strong>{workspace}</strong></div></div><span className="nav-caption">Tu plataforma</span><Navigation admin={actor.role === "ADMIN"} /><div className="sidebar-footer"><a className="company-signature" href="https://computerforms.com.mx/" target="_blank" rel="noopener noreferrer"><Image src="/brand/computerforms.svg" alt="Computer Forms" width={150} height={21} unoptimized /><span>Validación documental</span></a><div className="identity"><span className="avatar" aria-hidden="true">{user.name.slice(0, 2).toUpperCase()}</span><div><strong>{user.name}</strong><span>{user.email}</span></div></div><LogoutButton /></div></aside>
    <div className="app-main"><header className="topbar"><div className="topbar-context"><MobileNavigation admin={actor.role === "ADMIN"} workspace={workspace} name={user.name} /><span className="mobile-brand">Valweb</span><span>{workspace}</span></div><div className="topbar-account"><ShieldCheck size={16} aria-hidden="true" /><span className="role-label">{actor.role === "ADMIN" ? "Administrador" : "Cliente"}</span><span className="topbar-avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span></div></header><main id="main-content" className="page-content">{children}</main><footer className="panel-footer">Valweb <span>·</span> Una plataforma de Computer Forms</footer></div>
  </div>;
}
