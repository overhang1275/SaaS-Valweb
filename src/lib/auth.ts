import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { redirect } from "next/navigation";
import { authenticate, resolveActor } from "@/features/identity/service";
import { limitRequest } from "@/features/identity/rate-limit";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: [Credentials({
    name: "Correo y contraseña",
    credentials: { email: { type: "email" }, password: { type: "password" } },
    async authorize(credentials) {
      if (!credentials?.email || !credentials.password) return null;
      if (!await limitRequest("login-global", "all", 100, 60)) return null;
      const email = credentials.email.trim().toLowerCase().slice(0, 254);
      if (!await limitRequest("login", email, 5, 900)) return null;
      const actor = await authenticate(email, credentials.password);
      return actor && actor.role !== "CONSULTATION_ONLY" ? { id: actor.id, sessionVersion: actor.sessionVersion } : null;
    },
  })],
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.sub = user.id; token.sessionVersion = user.sessionVersion; }
      return token;
    },
    async session({ session, token }) {
      const actor = token.sub && typeof token.sessionVersion === "number"
        ? await resolveActor(token.sub, token.sessionVersion) : null;
      session.user = actor ? { id: actor.id, sessionVersion: actor.sessionVersion } : undefined;
      return session;
    },
  },
};

export async function getActor() {
  const session = await getServerSession(authOptions);
  return session?.user ? resolveActor(session.user.id, session.user.sessionVersion) : null;
}

export async function requireActor(admin = false) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.role === "CONSULTATION_ONLY") redirect("/login");
  if (admin && actor.role !== "ADMIN") redirect("/dashboard");
  return actor;
}
