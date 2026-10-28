"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  return <button type="button" className="logout" onClick={() => signOut({ callbackUrl: "/login" })}><LogOut size={18} aria-hidden="true" />Cerrar sesión</button>;
}
