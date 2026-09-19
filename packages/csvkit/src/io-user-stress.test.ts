import { test } from "vitest";
import assert from "node:assert/strict";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { ByteSource, CsvkitContext } from "./contracts.js";
import { defaultLimits, execute } from "./engine.js";
import { LazyInput } from "./io/index.js";
import reference from "../../../docs/csvkit/io-reference.json" with { type: "json" };

function fragmented(text: string): ByteSource {
  return { async *[Symbol.asyncIterator]() {
    yield new Uint8Array();
    for (const byte of new TextEncoder().encode(text)) {
      yield Uint8Array.of(byte);
      yield new Uint8Array();
    }
  } };
}

for (const [index, item] of reference.cases.entries()) {
  test(`user I/O frozen differential ${index}: empty chunks and byte boundaries in ${item.command}`, async () => {
    const files = new Map(Object.entries(item.files).map(([name, text]) => [`/work/${name}`, text]));
    const before = [...files];
    const cleanups: (() => Promise<void>)[] = [];
    let stdout = "", stderr = "";
    const context: CsvkitContext = {
      argv: new OwnedArguments(item.argv.map(value => new TextEncoder().encode(value)), defaultLimits),
      cwd: "/work", fs: {
        readFile: async () => { assert.fail("stream-capable filesystem must not bulk-read"); },
        readStream: path => {
          assert.ok(files.has(path), `unauthorized path ${path}`);
          return fragmented(files.get(path)!);
        },
        writeFile: async () => { assert.fail("these frozen cases have no side output"); }
      },
      stdin: fragmented(item.stdin), stdinIsDefault: false,
      stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
      stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
      env: {}, codecs: [utf8Codec], compression: [], databases: [],
      locale: { profile: "C", timezone: "UTC", formatNumber: () => { assert.fail("unexpected locale use"); } },
      clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
      registerCleanup: cleanup => { cleanups.push(cleanup); }
    };
    try {
      assert.deepEqual({ status: await execute(item.command, context), stdout, stderr },
        { status: item.status, stdout: item.stdout, stderr: item.stderr });
      assert.deepEqual([...files], before);
    } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
  });
}

test("user I/O physical skip and shared cursor preserve NUL in subsequent bulk read across empty chunks", async () => {
  for (const borrowed of [false, true]) {
    const file = new LazyInput(borrowed ? "<stdin>" : "data.csv", () => fragmented("a\0\r\nb\0\rc\0\n"),
      utf8Codec, "utf-8", new AbortController().signal, () => {}, () => {}, borrowed);
    try {
      assert.equal(await file.read(1), borrowed ? "b\0\rc\0\n" : "b\0\nc\0\n");
      assert.equal(await file.read(), "");
      assert.equal(await file.nextLine(), null);
    } finally { await file.close(); }
  }
});

test("user I/O BOM and multibyte fragments survive empty chunks with named universal newlines", async () => {
  for (const encoding of ["utf-8", "utf-8-sig"]) {
    const file = new LazyInput("data.csv", () => fragmented("\ufeffé\0\r\n😀\r終\n"),
      utf8Codec, encoding, new AbortController().signal, () => {}, () => {});
    try {
      assert.equal(await file.nextLine(), `${encoding === "utf-8" ? "\ufeff" : ""}é\n`);
      assert.equal(await file.read(), "😀\n終\n");
    } finally { await file.close(); }
  }
});
