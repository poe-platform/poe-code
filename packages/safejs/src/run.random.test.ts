import { afterEach, describe, expect, it, vi } from "vitest";

import { dump } from "./dump.js";
import { createSandboxClosure, createSandboxPromise } from "./interp/values.js";
import { restore, type SafeJSSnapshot } from "./restore.js";
import { run } from "./run.js";
import { serializeSafeJSSnapshot } from "./snapshot/dump-format.js";

describe("replayable default randomness", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(
    [
      "for (let index = 0; index < 3; index += 1)",
      "for (const index of [0, 1, 2])",
      "for (const index in [0, 1, 2])"
    ].flatMap((loop) => [
      { loop, body: "values.push(Math.random()); await wait();", savedLength: 1 },
      { loop, body: "values.push(await wait(Math.random()));", savedLength: 0 },
      {
        loop,
        body: "const first = Math.random(); await wait(); values.push(first, Math.random());",
        savedLength: 0
      },
      {
        loop,
        body: "const [first] = [Math.random()]; await wait(); values.push(first, Math.random());",
        savedLength: 0
      },
      {
        loop,
        body: "const { first } = { first: Math.random() }; await wait(); values.push(first, Math.random());",
        savedLength: 0
      }
    ])
  )("resumes $loop with $body", async ({ loop, body, savedLength }) => {
    const source = `const values = []; ${loop} { ${body} } return values;`;
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    let release!: () => void;
    let checkpointWritten!: (snapshot: SafeJSSnapshot) => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checkpoint = new Promise<SafeJSSnapshot>((resolve) => {
      checkpointWritten = resolve;
    });
    const execution = run(source, {
      snapshotIntervalMs: 1,
      snapshotBackend: {
        async read() {
          return undefined;
        },
        async remove() {},
        async write(snapshot) {
          checkpointWritten(JSON.parse(serializeSafeJSSnapshot(snapshot)));
        }
      },
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: (args) => {
            clock.mockReturnValue(2);
            return createSandboxPromise(gate.then(() => args[0]));
          }
        })
      }
    });
    const saved = await checkpoint;
    expect(saved.bindings).toMatchObject({
      values: Array.from({ length: savedLength }, () => expect.any(Number))
    });
    expect(saved.pendingAwaits).toMatchObject([
      { span: { start: { offset: source.indexOf("await wait") } } }
    ]);
    release();
    const original = await execution;
    const resumed = await run(source, {
      snapshot: restore(saved, { source }),
      bindings: {
        wait: createSandboxClosure({
          async: true,
          call: (args) => createSandboxPromise(Promise.resolve(args[0]))
        })
      }
    });
    expect(original.ok).toBe(true);
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: original.ok ? original.returnValue : undefined
    });
  });

  it.each([1, 16, 128])(
    "records enough state to reproduce %i draws without an explicit seed",
    async (width) => {
      const source = `return Array.from({ length: ${width} }, () => Math.random());`;
      const first = await run(source);
      expect(first.snapshot.random).toEqual({
        seed: expect.any(Number),
        initialState: expect.any(Number),
        state: expect.any(Number)
      });
      if (first.snapshot.random === undefined) throw new Error("Missing random state");
      const repeated = await run(source, { randomSeed: first.snapshot.random.seed });
      expect(repeated).toMatchObject({
        ok: true,
        returnValue: first.ok ? first.returnValue : undefined
      });
      expect(repeated.snapshot.random).toEqual(first.snapshot.random);
    }
  );

  it("replays a completed snapshot without advancing its random sequence", async () => {
    const source = "return Math.random();";
    const first = await run(source);
    expect(first.snapshot.random).toBeDefined();
    if (first.snapshot.random === undefined) throw new Error("Missing random state");
    const snapshot = restore(JSON.parse(await dump(first)), { source });
    await expect(run(source, { snapshot })).resolves.toMatchObject({
      ok: true,
      returnValue: first.ok ? first.returnValue : undefined
    });
  });

  it.each([-1, 0, 0.5, 4_294_967_296, Number.MAX_SAFE_INTEGER])(
    "keeps normalized seed %s restorable",
    async (randomSeed) => {
      const source = "return Math.random();";
      const first = await run(source, { randomSeed });
      const snapshot = restore(JSON.parse(await dump(first)), { source });
      expect(snapshot.random?.seed).toBe(Math.trunc(randomSeed) >>> 0);
      await expect(run(source, { snapshot })).resolves.toMatchObject({ ok: true });
    }
  );

  describe.each([
    "const first = Math.random(); await wait(); return [first, Math.random()];",
    "async function sample() { const first = Math.random(); await wait(); return [first, Math.random()]; } return await sample();"
  ])("checkpoint script: %s", (source) => {
    it.each([undefined, 123])(
      "matches uninterrupted execution with seed %s",
      async (randomSeed) => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const execution = run(source, {
          randomSeed,
          bindings: {
            wait: createSandboxClosure({ async: true, call: () => createSandboxPromise(gate) })
          }
        });
        const saved = JSON.parse(await dump(execution));
        release();
        const original = await execution;
        const resumed = await run(source, {
          snapshot: restore(saved, { source }),
          bindings: {
            wait: createSandboxClosure({
              async: true,
              call: () => createSandboxPromise(Promise.resolve())
            })
          }
        });
        expect(original.ok).toBe(true);
        expect(resumed).toMatchObject({
          ok: true,
          returnValue: original.ok ? original.returnValue : undefined
        });
      }
    );
  });
});
