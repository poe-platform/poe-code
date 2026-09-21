import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine } from "./engine.js";
import { parseCommand } from "./cli.js";
import type { CapabilityContext, Cleanup, EngineConfig } from "./contracts.js";
import type { GoalSeekRequest } from "./formulas.js";

function fixture(read?: (context: CapabilityContext) => Promise<void>) {
  const volume = Volume.fromJSON({ "/input.test": "input" });
  const events: string[] = [];
  const config: EngineConfig = {
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 5, outputBytes: 5, cells: 1, sheets: 1, operations: 2 },
    filesystem: {
      async read(uri) {
        events.push("read");
        return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)];
      },
      async write(uri, bytes) {
        events.push("write");
        volume.writeFileSync(uri, bytes);
      }
    },
    codecs: [
      {
        id: "test",
        description: "In-memory stress fixture",
        extensions: ["test"],
        async exportOptions(options) { return [...options]; },
        probeContent: () => true,
        async read(_bytes, context) {
          context.own(() => {
            events.push("cleanup");
          });
          await read?.(context);
          return { sheets: [{ id: "s", name: "s", cells: [] }] };
        },
        async write() {
          events.push("encode");
          return new Uint8Array([1]);
        }
      }
    ]
  };
  return { volume, events, engine: createEngine(config), config };
}
const request = {
  input: { kind: "resource" as const, uri: "/input.test" },
  destination: { kind: "resource" as const, uri: "/output.test" }
};

describe("independent ssconvert ownership stress", () => {
  it("captures admitted goals before mutable caller arrays change during import", async () => {
    const range = { sheet: "s", startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 };
    const goal = { target: range, variable: range, value: 1 };
    const goals: GoalSeekRequest[] = [goal];
    const { config, events } = fixture(async () => {
      goals.push(goal, goal);
      range.sheet = "changed";
      goal.value = 99;
    });
    const engine = createEngine({
      ...config,
      solver: {
        async goalSeek(book, admitted) {
          events.push(`goals:${admitted.length}:${admitted[0]!.target.sheet}:${admitted[0]!.value}`);
          return book;
        },
        async solve(book) {
          return book;
        }
      }
    });
    await engine.convert({ ...request, goalSeek: goals }, { signal: new AbortController().signal });
    expect(events).toEqual(["read", "goals:1:s:1", "encode", "write", "cleanup"]);
  });

  it("bounds analysis property copies before import or capability work", async () => {
    const { config, events } = fixture();
    const engine = createEngine({
      ...config,
      analysis: {
        async analyze(book) {
          events.push("analysis");
          return book;
        }
      }
    });
    await expect(
      engine.convert(
        {
          ...request,
          analysis: {
            tool: "fixture",
            properties: Array.from({ length: 3 }, () => ({ name: "n", value: "v" }))
          }
        },
        { signal: new AbortController().signal }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
    expect(events).toEqual([]);
  });

  it("captures resource bindings, ordered updates and exporter options at invocation", async () => {
    const cell = { sheet: "s", row: 0, column: 0, value: { kind: "string" as const, value: "admitted" } };
    const updates = [cell];
    const options = ["admitted"];
    const input = { ...request.input };
    const destination = { ...request.destination };
    const { config, events, volume } = fixture(async () => {
      updates.push(cell);
      cell.value.value = "mutated";
      options.push("mutated");
    });
    const engine = createEngine({
      ...config,
      codecs: [{
        ...config.codecs[0]!,
        async write(book, admitted) {
          const value = book.sheets[0]!.cells[0]!.value;
          events.push(`${value.kind === "string" ? value.value : "unexpected"}:${admitted.join(",")}`);
          return new Uint8Array([1]);
        }
      }]
    });
    const execution = engine.convert(
      { input, destination, updates, exportOptions: options },
      { signal: new AbortController().signal }
    );
    input.uri = "/absent.test";
    destination.uri = "/mutated.test";
    await execution;
    expect(events).toEqual(["read", "admitted:admitted", "write", "cleanup"]);
    expect(volume.existsSync("/output.test")).toBe(true);
    expect(volume.existsSync("/mutated.test")).toBe(false);
    expect(options).toEqual(["admitted", "mutated"]);
  });

  it("keeps Promise rejection and pre-aborted reason precedence before capture", async () => {
    const { engine, events } = fixture();
    const controller = new AbortController();
    const reason = { aborted: true };
    controller.abort(reason);
    let execution!: ReturnType<typeof engine.convert>;
    expect(() => {
      execution = engine.convert(
        { ...request, exportOptions: ["one", "two", "three"] },
        { signal: controller.signal }
      );
    }).not.toThrow();
    await expect(execution).rejects.toBe(reason);
    expect(events).toEqual([]);
  });

  it.each([false, true])("rejects disposed engines before request capture (aborted=%s)", async (aborted) => {
    const { engine, events } = fixture();
    await engine.dispose();
    const controller = new AbortController();
    if (aborted) controller.abort(new Error("later cancellation"));
    await expect(
      engine.convert({ ...request, recalc: true }, { signal: controller.signal })
    ).rejects.toMatchObject({ code: "invalid-request", message: "ssconvert engine is disposed" });
    expect(events).toEqual([]);
  });

  it("admits goal-seek work only within the operations budget", async () => {
    const { config, events, volume } = fixture();
    const engine = createEngine({
      ...config,
      solver: {
        async goalSeek(book, goals) {
          events.push(`goals:${goals.length}`);
          return book;
        },
        async solve(book) {
          throw new Error(`Unexpected solve of ${book.sheets.length} sheets`);
        }
      }
    });
    const range = { sheet: "s", startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 };
    const goal = { target: range, variable: range, value: 1 };
    const signal = new AbortController().signal;
    await expect(
      engine.convert({ ...request, goalSeek: [goal, goal, goal] }, { signal })
    ).rejects.toMatchObject({ code: "resource-limit" });
    expect(events).toEqual([]);
    expect(volume.existsSync("/output.test")).toBe(false);
    await engine.convert({ ...request, goalSeek: [goal, goal] }, { signal });
    expect(events).toEqual(["read", "goals:2", "encode", "write", "cleanup"]);
  });

  it("admits aggregate update and exporter work before reading input", async () => {
    const { engine, events, volume } = fixture();
    const update = { sheet: "s", row: 0, column: 0, value: { kind: "blank" as const } };
    const signal = new AbortController().signal;
    await expect(
      engine.convert(
        { ...request, updates: [update], exportOptions: ["first", "second"] },
        { signal }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
    expect(events).toEqual([]);
    expect(volume.existsSync("/output.test")).toBe(false);
    await engine.convert({ ...request, updates: [update], exportOptions: ["first"] }, { signal });
    expect(events).toEqual(["read", "encode", "write", "cleanup"]);
  });

  it("does not dispatch after synchronous host cleanup closes admission", async () => {
    const { engine, events } = fixture();
    await expect(
      engine.convert(request, {
        signal: new AbortController().signal,
        registerCleanup(close) {
          void close();
        }
      })
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(events).toEqual([]);
  });

  it("does not publish after host cleanup runs during codec work", async () => {
    let close!: Cleanup;
    const { engine, events, volume } = fixture(async () => {
      void close();
    });
    await expect(
      engine.convert(request, {
        signal: new AbortController().signal,
        registerCleanup(cleanup) {
          close = cleanup;
        }
      })
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(events).toEqual(["read", "cleanup"]);
    expect(volume.existsSync("/output.test")).toBe(false);
  });

  it("preserves cancellation reason and cleans up without output publication", async () => {
    const controller = new AbortController();
    const reason = { code: "ENOENT", cancellation: true };
    const { engine, events, volume } = fixture(async () => {
      controller.abort(reason);
    });
    await expect(engine.convert(request, { signal: controller.signal })).rejects.toBe(reason);
    expect(events).toEqual(["read", "cleanup"]);
    expect(volume.existsSync("/output.test")).toBe(false);
  });

  it("starts cleanup while draining admitted codec work and rejects later ownership", async () => {
    let close!: Cleanup;
    let release!: () => void;
    let entered!: () => void;
    const entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let context!: CapabilityContext;
    const { engine, events, volume } = fixture(async (supplied) => {
      context = supplied;
      entered();
      await barrier;
    });
    const result = engine
      .convert(request, {
        signal: new AbortController().signal,
        registerCleanup(cleanup) {
          close = cleanup;
        }
      })
      .catch((error) => error);
    await entry;
    let settled = false;
    const closure = Promise.resolve(close()).then(() => { settled = true; });
    expect(() => context.own(() => {})).toThrow("admission is closed");
    await Promise.resolve();
    expect(events).toEqual(["read", "cleanup"]);
    expect(settled).toBe(false);
    expect(() => context.own(() => {})).toThrow("admission is closed");
    release();
    await closure;
    expect(await result).toMatchObject({ code: "invalid-request" });
    expect(events).toEqual(["read", "cleanup"]);
    expect(volume.existsSync("/output.test")).toBe(false);
  });

  it("aggregates failed cleanups in reverse acquisition order", async () => {
    const first = new Error("first"),
      second = new Error("second");
    const { engine, volume } = fixture(async (context) => {
      context.own(() => {
        throw first;
      });
      context.own(() => {
        throw second;
      });
      throw new Error("work");
    });
    const failure = await engine
      .convert(request, { signal: new AbortController().signal })
      .catch((error) => error as AggregateError);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError)) throw new Error("Expected aggregate cleanup failure");
    expect(failure.errors[1].errors).toEqual([second, first]);
    expect(volume.existsSync("/output.test")).toBe(false);
  });

  it("rejects NUL in consumed option values", () => {
    expect(parseCommand(["-O", "x\0", "in.test", "out.test"])).toMatchObject({
      kind: "terminal",
      exitCode: 1
    });
  });

  it("does not dispatch later capabilities after goal seek cancels", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled goal seek capability");
    const { config, events } = fixture();
    const engine = createEngine({
      ...config,
      limits: { ...config.limits, operations: 3 },
      formulas: {
        async recalculate(book) {
          events.push("recalc");
          return book;
        }
      },
      solver: {
        async goalSeek(book) {
          controller.abort(reason);
          return book;
        },
        async solve(book) {
          events.push("solve");
          return book;
        }
      }
    });
    const range = { sheet: "s", startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 };
    await expect(
      engine.convert(
        {
          ...request,
          goalSeek: [{ target: range, variable: range, value: 1 }],
          recalc: true,
          solve: true
        },
        { signal: controller.signal }
      )
    ).rejects.toBe(reason);
    expect(events).toEqual(["read", "cleanup"]);
  });
});
