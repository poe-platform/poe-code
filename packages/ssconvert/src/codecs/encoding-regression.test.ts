import { expect, it } from "vitest";
import { encodeText } from "../encoding/encode.js";
import { readText } from "./text.js";
import type { CapabilityContext } from "../contracts.js";
import { createEngine, runCommand } from "../index.js";
import { Volume } from "memfs";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 },
  own() {}
};

it("encodes CP437 letters and escapes unrepresentable Unicode scalars", () => {
  expect(encodeText("éα😀\n", "CP437", false, context))
    .toEqual(new Uint8Array([130, 224, ...new TextEncoder().encode("\\U0001f600\n")]));
});

it("decodes the native LATIN10 alias instead of silently importing Latin-1", async () => {
  const book = await readText(new Uint8Array([170, 10]), context, "LATIN10");
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "Ș" });
});

it.each([
  [{ LC_ALL: "C.UTF-8", LC_CTYPE: "C", LANG: "C" }, '"e ss EUR ? :-D",1.2\n'],
  [{ LC_ALL: "", LC_CTYPE: "C.UTF-8", LANG: "C" }, '"e ss EUR ? :-D",1.2\n'],
  [{ LC_ALL: "", LC_CTYPE: "C", LANG: "C.UTF-8" }, '"? ss EUR ? ?",1.2\n']
])("uses injected locale precedence and the converter's pre-override locale", async (env, expected) => {
  const fs = Volume.fromJSON({ "/input.csv": '"é ß € 漢 😀",1.2\n' });
  const engine = createEngine({ codecs: [], limits: context.limits,
    environment: { ...context.environment, env }, filesystem: {
      async read(path) { return [new Uint8Array(fs.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { fs.writeFileSync(path, bytes); }
    } });
  const stderr: number[] = [];
  try {
    const status = await runCommand(["-T", "Gnumeric_stf:stf_assistant", "-O",
      "charset=ASCII locale=C transliterate-mode=transliterate", "/input.csv", "/output.csv"], engine, {
      signal: context.signal, stdout: { async write() {} },
      stderr: { async write(bytes) { stderr.push(...bytes); } }
    });
    expect(status.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(new Uint8Array(fs.readFileSync("/output.csv") as Uint8Array)).toEqual(new TextEncoder().encode(expected));
  } finally { await engine.dispose(); }
});

it("rejects a source-admitted uncaptured import encoding instead of silently guessing", async () => {
  await expect(readText(new TextEncoder().encode("abc\n"), context, "JOHAB"))
    .rejects.toThrow("uncaptured import charset");
});

it.each(["LC_ALL", "LC_CTYPE", "LC_NUMERIC", "LC_TIME", "LANG"])("rejects missing %s capability without input/output effects", async category => {
  const fs = Volume.fromJSON({ "/input.csv": "1.2\n", "/keep.csv": "original" });
  let reads = 0;
  const engine = createEngine({ codecs: [], limits: context.limits,
    environment: { ...context.environment, env: { [category]: "missing_LOCALE" } }, filesystem: {
      async read(path) { reads++; return [new Uint8Array(fs.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { fs.writeFileSync(path, bytes); }
    } });
  const errors: Uint8Array[] = [];
  const operation = { signal: context.signal, stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(new Uint8Array(bytes)); } } };
  try {
    const result = await runCommand(["/input.csv", "/keep.csv"], engine, operation);
    expect(result.exitCode).toBe(1);
    expect(errors).toEqual([new TextEncoder().encode("Unsupported ssconvert feature: uncaptured runtime locale missing_LOCALE\n")]);
    await expect(engine.readWorkbook({ kind: "resource", uri: "/input.csv" }, {}, operation))
      .rejects.toThrow("uncaptured runtime locale missing_LOCALE");
    expect(reads).toBe(0);
    expect(fs.toJSON()).toEqual({ "/input.csv": "1.2\n", "/keep.csv": "original" });
  } finally { await engine.dispose(); }
});
