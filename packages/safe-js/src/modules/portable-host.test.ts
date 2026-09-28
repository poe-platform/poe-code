import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#safe-js-platform", async () => import("../platform/workerd.js"));

import { EnvAccessError, makeEnvModule } from "./env.js";
import { makeLogModule } from "./log.js";
import { makeAgentModule } from "./agent.js";
import { noopOtelSink } from "../observability/otel.js";

function withoutProcess<T>(callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "process")!;
  Reflect.deleteProperty(globalThis, "process");
  try {
    return callback();
  } finally {
    Object.defineProperty(globalThis, "process", descriptor);
  }
}

afterEach(() => vi.restoreAllMocks());

describe("module factories on portable hosts", () => {
  it("returns missing ambient values and preserves explicit values and access checks without process", () => {
    withoutProcess(() => {
      for (const input of [["TOKEN"], { allow: ["TOKEN"] }]) {
        const env = makeEnvModule(input);
        expect(env.get("TOKEN")).toBeUndefined();
        expect(() => env.get("DENIED")).toThrow(EnvAccessError);
      }
      expect(makeEnvModule({ allow: ["TOKEN"], values: { TOKEN: "bound" } }).get("TOKEN")).toBe("bound");
    });
  });

  it.each(["missing process", "missing stdout"])("writes normalized JSON to console with %s", (host) => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const write = () => {
      const log = makeLogModule();
      const payload: Record<string, unknown> = { count: 1n };
      payload.self = payload;
      log.info("hello", undefined);
      log.error("failed");
      log.event("done", payload);
    };
    if (host === "missing process") {
      withoutProcess(write);
    } else {
      const descriptor = Object.getOwnPropertyDescriptor(process, "stdout")!;
      Object.defineProperty(process, "stdout", { configurable: true, value: undefined });
      try { write(); } finally { Object.defineProperty(process, "stdout", descriptor); }
    }
    expect(consoleLog).toHaveBeenCalledTimes(3);
    const entries = consoleLog.mock.calls.map(([line]) => JSON.parse(line as string));
    expect(entries).toEqual([
      { ts: expect.any(String), type: "info", args: ["hello", null] },
      { ts: expect.any(String), type: "error", args: ["failed"] },
      { ts: expect.any(String), type: "event", name: "done", payload: { count: "1", self: "[Circular]" } }
    ]);
  });

  it("spawns without an explicit cwd using the portable platform", async () => {
    const spawn = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "", summary: "", durationMs: 1 }));
    const startSpan = vi.fn(noopOtelSink.startSpan);
    const agent = makeAgentModule(spawn, { otelSink: { ...noopOtelSink, startSpan } });
    const result = withoutProcess(() => agent.spawn("codex", { prompt: "inspect" }));
    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    expect(spawn).toHaveBeenCalledOnce();
    expect(startSpan).toHaveBeenCalledWith("agent.spawn", expect.objectContaining({ cwd: "/" }));
  });
});
