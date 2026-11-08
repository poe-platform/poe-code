import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { declareHostOperation } from "../interp/host-bridge.js";

it("serializes an async function at its pending host-call checkpoint", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(0);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const errors: unknown[] = [];
  let saved: string | undefined;
  try {
    const result = await run("export default async()=>{await boundary();return 42}", {
      entryPointArgs: [],
      bindings: {boundary: declareHostOperation(async () => {clock.mockReturnValue(2);await gate;}, "re-issue")},
      snapshotIntervalMs: 1,
      snapshotBackend: {async read() {}, async remove() {}, async write(snapshot) {
        try {saved = await dump({snapshot});} catch(error) {errors.push(error);} finally {release();}
      }}
    });
    expect(errors).toEqual([]);
    expect(saved).toBeTypeOf("string");
    expect(result).toMatchObject({ok:true,returnValue:42});
  } finally {clock.mockRestore();release();}
});
