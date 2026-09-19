import { test } from "vitest";
import assert from "node:assert/strict";
import reference from "../../../docs/csvkit/encoding-reference.json" with { type: "json" };
import primitiveReference from "../../../docs/csvkit/codec-primitives-reference.json" with { type: "json" };
import { defaultLimits, execute } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { pythonCodecs, resolveCodec } from "./codecs/python.js";
import { diagnosticReport } from "./diagnostics/index.js";
import { CsvkitDiagnostic } from "./errors.js";
import type { ByteSource, CsvkitContext } from "./contracts.js";

function source(bytes: Uint8Array, fragmented: boolean): ByteSource {
  return { async *[Symbol.asyncIterator]() {
    if (!fragmented) { yield bytes; return; }
    for (const byte of bytes) { yield Uint8Array.of(byte); yield new Uint8Array(); }
  } };
}

for (const item of reference.cases) {
  // Output stream encoding is a separate explicit host binding. These captures
  // measure Python stream behavior, not UTF-8 product parity.
  if (item.label === "environment utf-8-sig" || item.label.startsWith("output profile ")) {
    test.todo(`profile divergence: ${item.label}; host stdout currently UTF-8`);
    continue;
  }
  for (const fragmented of [false, true]) test(`encoding reference: ${item.label} ${item.argv.join(" ")} ${fragmented ? "bytewise" : "bulk"}`, async () => {
    const stdout: number[] = [], stderr: number[] = [];
    const files = new Map(Object.entries(item.files).map(([path, hex]) => [`/${path}`, Uint8Array.from(Buffer.from(hex, "hex"))]));
    const before = [...files].map(([name, bytes]) => [name, [...bytes]]);
    const cleanups: (() => Promise<void>)[] = [];
    const context: CsvkitContext = {
      argv: new OwnedArguments(item.argv.map(value => new TextEncoder().encode(value)), defaultLimits), cwd: "/",
      fs: {
        readFile: async path => { assert.ok(files.has(path)); return files.get(path)!; },
        readStream: path => { assert.ok(files.has(path)); return source(files.get(path)!, fragmented); },
        writeFile: async () => { assert.fail("unexpected write"); }
      },
      stdin: source(Uint8Array.from(Buffer.from(item.stdin, "hex")), fragmented), stdinIsDefault: false,
      stdout: { write: async bytes => { stdout.push(...bytes); } }, stderr: { write: async bytes => { stderr.push(...bytes); } },
      env: { ...reference.environment, ...item.env }, codecs: pythonCodecs, compression: [], databases: [],
      locale: { profile: "C", timezone: "UTC", formatNumber: () => { assert.fail("unexpected locale"); } }, clock: { now: () => 0 },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
      limits: defaultLimits, signal: new AbortController().signal, registerCleanup: cleanup => { cleanups.push(cleanup); }
    };
    try {
      assert.deepEqual({ status: await execute(item.command, context), stdout: Buffer.from(stdout).toString("hex"), stderr: Buffer.from(stderr).toString("hex") },
        { status: item.status, stdout: item.stdout, stderr: item.stderr });
      assert.deepEqual([...files].map(([name, bytes]) => [name, [...bytes]]), before);
    } finally { await Promise.all(cleanups.map(cleanup => cleanup())); }
  });
}

for (const [index, item] of primitiveReference.cases.entries()) {
  test(`strict Python codec primitive ${index}: ${item.encoding} ${item.input}`, async () => {
    const resolved = resolveCodec(pythonCodecs, item.encoding);
    const decode = () => resolved.codec.decode(Uint8Array.from(Buffer.from(item.input, "hex")), resolved.encoding, new AbortController().signal);
    if ("error" in item) {
      await assert.rejects(decode, failure => {
        assert.ok(failure instanceof CsvkitDiagnostic);
        assert.equal(diagnosticReport(failure, false, item.encoding).stderr,
          `Your file is not "${item.encoding}" encoded. Please specify the correct encoding with the --encoding flag. Use the -v flag to see the complete error.\n`);
        return true;
      });
    } else {
      assert.equal(await decode(), item.text);
      assert.equal(Buffer.from(await resolved.codec.encode(item.text, resolved.encoding, new AbortController().signal)).toString("hex"), item.encoded);
    }
  });
}
