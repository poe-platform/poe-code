import { expect, it } from "vitest";
import proof from "../../../../docs/ssconvert/paradox-encryption-gap-proof.json" with { type: "json" };
import { Volume } from "memfs";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import type { CapabilityContext } from "../contracts.js";
import { decryptParadoxBlocks } from "./paradox-encryption.js";
import { readParadox } from "./paradox.js";
const bytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
it.each(proof.cases)("decodes original pxlib encrypted $id", async fixture => {
  const input = bytes(fixture.inputHex), original = input.slice(), messages: string[] = [];
  const book = await readParadox(input, { ...context, async diagnostic(d) { messages.push(d.message); },
    password: { async read() { throw new Error("Paradox must not ask for a password"); } } });
  expect(book.sheets[0]!.cells.map(c => c.value.kind === "number" || c.value.kind === "string" ? c.value.value : undefined))
    .toEqual(fixture.expectedValues);
  expect(input).toEqual(original);
  expect(messages).toEqual(fixture.version === 4 ? ["Target encoding could not be set."] : []);
});

it("preserves unsigned block-number wrap in independent byte-level holdouts", async () => {
  const cases = proof.primitive.filter(c => c.blockNumber <= 257), input = new Uint8Array(257 * 1024);
  for (const fixture of cases) input.set(bytes(fixture.inputHex), (fixture.blockNumber - 1) * 1024);
  const output = await decryptParadoxBlocks(input, 0, 1024, cases[0]!.key,
    { ...context, limits: { ...context.limits, inputBytes: 1000000 } });
  for (const fixture of cases)
    expect(output.subarray((fixture.blockNumber - 1) * 1024, fixture.blockNumber * 1024)).toEqual(bytes(fixture.expectedHex));
});
it("enforces the combined header-copy and physical-payload work limit", async () => {
  const input = bytes(proof.cases[0]!.inputHex);
  await expect(decryptParadoxBlocks(input, 512, 1024, 1, { ...context,
    limits: { ...context.limits, workbookWork: input.length + 1024 - 1 } })).rejects.toThrow("decryption work limit");
  expect(input).toEqual(bytes(proof.cases[0]!.inputHex));
});
it("cancels inside a large encrypted block without mutating borrowed input", async () => {
  const fixture = proof.cases.find(c => c.blockSize === 32768)!, input = bytes(fixture.inputHex), original = input.slice();
  let checks = 0;
  const signal = { throwIfAborted() { if (++checks === 10) throw new Error("cancel Paradox block"); } } as AbortSignal;
  await expect(decryptParadoxBlocks(input, 512, fixture.blockSize, fixture.key, { ...context, signal }))
    .rejects.toThrow("cancel Paradox block");
  expect(input).toEqual(original);
});
it.each([1,255,1023])("refuses incomplete encrypted block length %i", async length => {
  const input = bytes(proof.cases[0]!.inputHex).subarray(0, 512 + length);
  await expect(readParadox(input, context)).rejects.toThrow("Truncated encrypted Paradox block");
});

it.each(["truncated", "work"])("preserves public-command targets after encrypted Paradox %s refusal", async mode => {
  const source = bytes(proof.cases[0]!.inputHex), input = mode === "truncated" ? source.subarray(0, 513) : source;
  const volume = Volume.fromJSON({ "/target.csv": "untouched\n" }); volume.writeFileSync("/input.db", input);
  let writes = 0;
  const engine = createEngine({ codecs: [], environment: context.environment,
    limits: mode === "work" ? { ...context.limits, workbookWork: 100 } : context.limits,
    filesystem: { cwd: "/", async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, value) { writes++; volume.writeFileSync(uri, value); } } });
  const stderr: Uint8Array[] = [];
  try {
    expect(await runCommand(["-T", "Gnumeric_stf:stf_csv", "/input.db", "/target.csv"], engine,
      { signal: context.signal, stdout: { async write() {} }, stderr: { async write(value) { stderr.push(value); } } }))
      .toMatchObject({ exitCode: 1 });
    expect(Buffer.concat(stderr).toString()).toContain(mode === "work" ? "decryption work limit" : "Truncated encrypted Paradox block");
    expect(writes).toBe(0); expect(volume.readFileSync("/target.csv", "utf8")).toBe("untouched\n");
    expect(new Uint8Array(volume.readFileSync("/input.db") as Uint8Array)).toEqual(input);
  } finally { await engine.dispose(); }
});

it("yields during decryption so a host abort can stop physical block work", async () => {
  const input = new Uint8Array(1024 * 1024), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("host cancelled Paradox")), 0);
  try {
    await expect(Promise.resolve(decryptParadoxBlocks(input, 0, 1024, 1,
      { ...context, signal: controller.signal, limits: { ...context.limits, inputBytes: input.length } })))
      .rejects.toThrow("host cancelled Paradox");
  } finally { clearTimeout(timer); }
});
