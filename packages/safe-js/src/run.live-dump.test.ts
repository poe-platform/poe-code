import { expect, it } from "vitest";
import { run } from "./run.js";
import { dump, dumpCurrent } from "./dump.js";

it.each([dump, dumpCurrent])("rejects an unsupported live dump before the host operation settles (%#)", async capture => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const controller = new AbortController();
  const execution = run("import {wait} from 'cap'; await wait();", {
    extensions: [],
    signal: controller.signal,
    modules: { cap: { wait: () => { started(); return new Promise(() => {}); } } }
  });
  const completion = execution.catch(error => error);
  try {
    await ready;
    const captured = capture(execution).then(
      () => ({ status: "fulfilled" }),
      (error: unknown) => ({ status: "rejected", error })
    );
    // A turn boundary detects a stuck request without a timeout or wall-clock race.
    const result = await Promise.race([
      captured,
      new Promise(resolve => setImmediate(() => resolve({ status: "pending" })))
    ]);
    expect(result).toMatchObject({
      status: "rejected",
      error: { name: "TypeError", message: "Snapshot is not replayable: Live realm state cannot be serialized or replayed." }
    });
  } finally {
    controller.abort(new Error("cancel pending host operation"));
    expect(await completion).toMatchObject({ message: "cancel pending host operation" });
  }
});

it("does not interrupt a live run when its unsupported dump is requested", async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let finish!: (value: number) => void;
  const pending = new Promise<number>(resolve => { finish = resolve; });
  const execution = run("import {wait} from 'cap'; return await wait();", {
    extensions: [],
    modules: { cap: { wait: () => { started(); return pending; } } }
  });
  await ready;
  const captured = dump(execution).catch(error => error);
  finish(7);
  expect(await execution).toMatchObject({ ok: true, returnValue: 7 });
  expect(await captured).toBeInstanceOf(TypeError);
  await expect(dump(execution)).rejects.toThrow("Live realm state cannot be serialized or replayed");
});
