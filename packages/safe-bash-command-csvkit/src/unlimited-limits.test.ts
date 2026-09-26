import { expect, it } from "vitest";
import { defaultLimits, run, type InvocationContext } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { SettingsAdmission } from "./settings-admission.js";
import { createGzipCompressionProvider } from "./io/compression.js";

it("disables every default resource limit", () => {
  expect(Object.values(defaultLimits).every(value => value === Infinity)).toBe(true);
});
it("admits explicit Infinity through SDK invocation and bigint settings", async () => {
  const limits = Object.fromEntries(Object.keys(defaultLimits).map(key => [key, Infinity])) as unknown as typeof defaultLimits;
  const context = { limits, signal: new AbortController().signal, env: {}, terminal: {}, codecs: [], compression: [], databases: [] } as unknown as InvocationContext;
  await expect(run({ command: "unknown" } as never, context)).rejects.toThrow("Unknown csvkit executable");
  expect(new OwnedArguments([new Uint8Array([1])], limits).byteLength).toBe(1);
  expect(() => new SettingsAdmission(limits, context.signal).admit(123n)).not.toThrow();
  let nested: unknown = true;
  for (let index = 0; index < 300; index++) nested = { child: nested };
  expect(() => new SettingsAdmission(limits, context.signal).admit(nested)).not.toThrow();
  const admission = new SettingsAdmission({ ...limits, maxArgumentBytes: 2 }, context.signal);
  expect(() => admission.admit(123n)).toThrow("argument byte budget");
});
it("admits unlimited gzip members while preserving finite limits", async () => {
  const codec = { memberAdmission: true as const, CodecReader: class {
    async chunk() { return new Uint8Array([1]); }
    restore() {}
    async close() {}
  }, async *codec(_reader: unknown, options: { onMember(): void }) {
    options.onMember(); options.onMember(); yield new Uint8Array([2]);
  } };
  const provider = createGzipCompressionProvider(codec);
  const read = async (maxArchiveMembers: number) => {
    const chunks = [];
    for await (const chunk of provider.decode((async function* () {})(), new AbortController().signal, { maxArchiveMembers })) chunks.push(chunk);
    return chunks;
  };
  await expect(read(Infinity)).resolves.toEqual([new Uint8Array([2])]);
  await expect(read(1)).rejects.toThrow("member budget");
});
