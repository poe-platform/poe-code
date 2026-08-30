import { afterEach, describe, expect, it, vi } from "vitest";

import { makeLogModule } from "./log.js";

function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => T
): T {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("makeLogModule", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes info, error, and event records to the provided sink", () => {
    const sink = vi.fn();
    const log = makeLogModule(sink);

    log.info("started", { round: 1 });
    log.error("failed", { code: "E_FAIL" });
    log.event("task.started", { id: "task-1" });

    expect(sink).toHaveBeenCalledTimes(3);

    expect(sink).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "info",
        args: ["started", { round: 1 }]
      })
    );
    expect(sink).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "error",
        args: ["failed", { code: "E_FAIL" }]
      })
    );
    expect(sink).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: "event",
        name: "task.started",
        payload: { id: "task-1" }
      })
    );

    for (const [entry] of sink.mock.calls) {
      expect(Number.isNaN(Date.parse(entry.ts))).toBe(false);
    }
  });

  it("trims event names before writing them to the sink", () => {
    const sink = vi.fn();
    const log = makeLogModule(sink);

    log.event("  task.finished  ", { ok: true });

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "event",
        name: "task.finished",
        payload: { ok: true }
      })
    );
  });

  it("rejects blank event names", () => {
    const sink = vi.fn();
    const log = makeLogModule(sink);

    expect(() => log.event("   ", { ok: false })).toThrow("Event name must be a non-empty string.");
    expect(sink).not.toHaveBeenCalled();
  });

  it("rejects non-function sinks", () => {
    expect(() => makeLogModule({} as never)).toThrow("Log sink must be a function.");
  });

  it("uses the default sink to emit JSONL records to stdout", () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = makeLogModule();

    log.info("hello", 42);
    log.event("task.finished", { ok: true });

    const lines = stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);

    const info = JSON.parse(lines[0]) as Record<string, unknown>;
    const event = JSON.parse(lines[1]) as Record<string, unknown>;

    expect(info).toMatchObject({
      type: "info",
      args: ["hello", 42]
    });
    expect(event).toMatchObject({
      type: "event",
      name: "task.finished",
      payload: { ok: true }
    });
    expect(Number.isNaN(Date.parse(String(info.ts)))).toBe(false);
    expect(Number.isNaN(Date.parse(String(event.ts)))).toBe(false);
  });

  it("ignores default sink stdout EPIPE writes", () => {
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementationOnce(() => true)
      .mockImplementation(() => {
        throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      });
    const log = makeLogModule();

    expect(() => {
      log.info("first");
      log.info("second");
      log.info("third");
    }).not.toThrow();
    expect(stdoutWrite).toHaveBeenCalledTimes(2);
  });

  it("serializes default-sink records that JSON.stringify cannot handle directly", () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = makeLogModule();
    const circularPayload: Record<string, unknown> = {
      count: 1n,
      error: new Error("boom"),
      skipped: undefined
    };

    circularPayload.self = circularPayload;

    expect(() => {
      log.error(new Error("stderr"));
      log.event("task.failed", circularPayload);
    }).not.toThrow();

    const lines = stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk).trim())
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);

    const errorEntry = JSON.parse(lines[0]) as Record<string, unknown>;
    const eventEntry = JSON.parse(lines[1]) as Record<string, unknown>;

    expect(errorEntry).toMatchObject({
      type: "error",
      args: [
        {
          name: "Error",
          message: "stderr"
        }
      ]
    });
    expect(eventEntry).toMatchObject({
      type: "event",
      name: "task.failed",
      payload: {
        count: "1",
        error: {
          name: "Error",
          message: "boom"
        },
        skipped: null,
        self: "[Circular]"
      }
    });
  });

  it("ignores inherited Error causes when serializing default-sink records", () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = makeLogModule();

    withObjectPrototypeProperties({ cause: new Error("polluted") }, () => {
      log.error(new Error("stderr"));
    });

    const errorEntry = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0])) as {
      args: Array<Record<string, unknown>>;
    };

    expect(errorEntry.args[0]).toMatchObject({
      message: "stderr",
      name: "Error"
    });
    expect(errorEntry.args[0]).not.toHaveProperty("cause");
  });

  it("serializes own __proto__ event payload fields to JSONL", () => {
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = makeLogModule();

    log.event("task.special", Object.fromEntries([["__proto__", "preserved"]]));

    const eventEntry = JSON.parse(String(stdoutWrite.mock.calls[0]?.[0])) as {
      payload: Record<string, unknown>;
    };

    expect(Object.hasOwn(eventEntry.payload, "__proto__")).toBe(true);
    expect(eventEntry.payload.__proto__).toBe("preserved");
  });
});
