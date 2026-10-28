import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.VALWEB_TEST_INSTANCE === "1" ? ".next-test" : ".next",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/public-validation-sw.js", headers: [
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      { key: "Cache-Control", value: "no-store" },
      { key: "Service-Worker-Allowed", value: "/v/" },
    ] }, { source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` },
    ] }];
  },
};

export default config;
