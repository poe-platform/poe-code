import assert from "node:assert/strict";
import { test } from "vitest";
import { Volume } from "memfs";
import { execute, run, defaultLimits, type CsvkitRequest } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";

const encoder = new TextEncoder();
type Request = Extract<CsvkitRequest, { command: "csvformat" | "in2csv" | "csvjson" | "csvstat" }>;
const cases: readonly { name: string; input: string; argv: readonly string[]; request: Request; stdout: string }[] = [
  { name: "quoted Unicode CSV to tabs", input: '\ufeffname,note\n猫,"😀\ninside"\n', argv: ["-T"],
    request: { command: "csvformat", settings: { out_tabs: true } }, stdout: 'name\tnote\n猫\t"😀\ninside"\n' },
  { name: "JSON prototype-like keys and exact integer text", input: '\ufeff[{"__proto__":"猫😀","constructor":9007199254740993}]', argv: ["-f", "json", "-I"],
    request: { command: "in2csv", settings: { filetype: "json", no_inference: true } }, stdout: '__proto__,constructor\n猫😀,9007199254740993\n' },
  { name: "NDJSON disjoint columns and quoted newline", input: '{"a":"猫😀"}\n{"b":"x\\ny"}\n', argv: ["-f", "ndjson", "-I"],
    request: { command: "in2csv", settings: { filetype: "ndjson", no_inference: true } }, stdout: 'a,b\n猫😀,\n,"x\ny"\n' },
  { name: "stream JSON escaped Unicode multiline", input: '\ufeffname,note\n猫,"😀\ninside"\n', argv: ["-y0", "-I", "--stream"],
    request: { command: "csvjson", settings: { sniff_limit: 0, no_inference: true, streamOutput: true } }, stdout: '{"name": "猫", "note": "😀\\ninside"}\n' },
  { name: "count logical rather than physical records", input: '\ufeffname,note\n猫,"😀\ninside"\n犬,end\n', argv: ["-y0", "--count"],
    request: { command: "csvstat", settings: { sniff_limit: 0, count_only: true } }, stdout: '2\n' }
];

for (const item of cases) for (const named of [false, true]) test(`user byte boundaries ${item.name} ${named ? "memfs file" : "stdin"}`, async () => {
  const original = encoder.encode(item.input);
  // Every possible two-chunk split plus a reusable single-byte buffer.
  for (let split = 0; split <= original.length + 1; split++) for (const sdk of [false, true]) {
    const volume = Volume.fromJSON({ "/input": Buffer.from(original) });
    let closed = 0;
    const source = { async *[Symbol.asyncIterator]() {
      try {
        if (split <= original.length) {
          yield original.slice(0, split);
          yield original.slice(split);
        } else {
          const reusable = new Uint8Array(1);
          for (const byte of original) { reusable[0] = byte; yield reusable; reusable[0] = 0xff; }
        }
      } finally { closed++; }
    } };
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const cleanups: (() => Promise<void>)[] = [];
    const context: CsvkitContext = {
      argv: new OwnedArguments([...item.argv, ...(named ? ["input"] : [])].map(arg => encoder.encode(arg)), defaultLimits), cwd: "/",
      fs: { readFile: async path => Uint8Array.from(volume.readFileSync(path) as Buffer),
        readStream: path => { assert.equal(path, "/input"); return source; },
        writeFile: async () => { throw new Error("unexpected write"); } },
      stdin: named ? { [Symbol.asyncIterator]: () => ({ next: async () => { throw new Error("unexpected stdin"); } }) } : source,
      stdinIsDefault: false, stdout: { write: async bytes => { stdout.push(Uint8Array.from(bytes)); } },
      stderr: { write: async bytes => { stderr.push(Uint8Array.from(bytes)); } },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
      env: {}, codecs: [utf8Codec], compression: [], databases: [],
      locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected locale"); } },
      clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
      registerCleanup: cleanup => { cleanups.push(cleanup); }
    };
    try {
      const request = named ? { ...item.request, settings: { ...item.request.settings, input_path: "input" } } : item.request;
      const status = sdk ? await run(request, context) : await execute(item.request.command, context);
      assert.deepEqual({ status, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") },
        { status: 0, stdout: item.stdout, stderr: "" }, `split=${split} sdk=${sdk}`);
    } finally { for (const cleanup of cleanups) await cleanup(); }
    assert.equal(closed, 1);
    assert.deepEqual(Uint8Array.from(volume.readFileSync("/input") as Buffer), original);
    assert.deepEqual(volume.readdirSync("/"), ["input"]);
  }
});
