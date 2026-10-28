import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

type FetchHandler = (event: { request: { method: string; mode: string; url: string }; respondWith: (value: Promise<Response>) => void }) => void;
function worker() {
  const handlers = new Map<string, FetchHandler>();
  const fetch = vi.fn();
  runInNewContext(readFileSync("public/public-validation-sw.js", "utf8"), { self: { location: { origin: "https://valweb.example" }, addEventListener: (name: string, listener: FetchHandler) => handlers.set(name, listener), skipWaiting: vi.fn(), clients: { claim: vi.fn() } }, URL, Response, fetch });
  return { handler: handlers.get("fetch")!, fetch };
}
it("does not intercept APIs, image POSTs, private navigation or other origins", () => {
  const { handler, fetch } = worker(); const respondWith = vi.fn();
  for (const request of [
    { method: "POST", mode: "cors", url: "https://valweb.example/api/public/images" },
    { method: "GET", mode: "cors", url: "https://valweb.example/api/public/images" },
    { method: "GET", mode: "navigate", url: "https://valweb.example/login" },
    { method: "GET", mode: "navigate", url: "https://external.example/v/a" },
  ]) handler({ request, respondWith });
  expect(respondWith).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it("always fetches public navigation without cache and preserves server errors", async () => {
  const { handler, fetch } = worker(); fetch.mockResolvedValue(new Response("Unavailable", { status: 404 })); let pending!: Promise<Response>;
  handler({ request: { method: "GET", mode: "navigate", url: "https://valweb.example/v/a" }, respondWith: value => { pending = value; } });
  expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ url: "https://valweb.example/v/a" }), { cache: "no-store" });
  expect((await pending).status).toBe(404);
});
it("shows only a generic non-cached offline page after a failed navigation", async () => {
  const { handler, fetch } = worker(); fetch.mockRejectedValue(new Error("Offline")); let pending!: Promise<Response>;
  handler({ request: { method: "GET", mode: "navigate", url: "https://valweb.example/v/a" }, respondWith: value => { pending = value; } });
  const response = await pending; expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toContain("Sin conexión");
});
