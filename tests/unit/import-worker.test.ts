import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ work: vi.fn(), send: vi.fn(), offWork: vi.fn(), stop: vi.fn(), disconnect: vi.fn() }));
vi.mock("../../src/features/imports/queue", () => ({ getImportQueue: async () => mocks }));
vi.mock("../../src/features/imports/runner", () => ({ processImport: vi.fn() }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { importJob: { findMany: async () => [] }, $disconnect: mocks.disconnect } }));
afterEach(() => vi.restoreAllMocks());
it("drains the active import before stopping the queue and ignores repeated signals", async () => {
  let finish!: () => void;
  mocks.offWork.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  const signals = new Map<string, () => void>();
  const on = process.on.bind(process);
  vi.spyOn(process, "on").mockImplementation((event, listener) => {
    if (event === "SIGINT" || event === "SIGTERM") { signals.set(event, listener); return process; }
    return on(event, listener);
  });
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  await import("../../scripts/import-worker");
  signals.get("SIGTERM")!(); signals.get("SIGINT")!();
  expect(mocks.offWork).toHaveBeenCalledExactlyOnceWith("valweb-import", { wait: true });
  expect(mocks.stop).not.toHaveBeenCalled(); expect(exit).not.toHaveBeenCalled();
  finish();
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
  expect(mocks.stop).toHaveBeenCalledExactlyOnceWith({ graceful: true });
  expect(mocks.disconnect).toHaveBeenCalledOnce();
});
