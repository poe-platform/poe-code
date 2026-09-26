import assert from "node:assert/strict";
import { test } from "vitest";
import { Volume } from "memfs";
import { execute, run, defaultLimits, type CsvkitRequest } from "./engine.js";
import { OwnedArguments } from "./argv.js";
import { utf8Codec } from "./codecs/utf8.js";
import type { CsvkitContext } from "./contracts.js";
import raw from "../../../docs/csvkit/raw-operation-reference.json" with { type: "json" };
import additional from "../../../docs/csvkit/additional-operation-reference.json" with { type: "json" };
import stack from "../../../docs/csvkit/csvstack-reference.json" with { type: "json" };
import join from "../../../docs/csvkit/csvjoin-reference.json" with { type: "json" };
import sort from "../../../docs/csvkit/csvsort-reference.json" with { type: "json" };
import look from "../../../docs/csvkit/csvlook-reference.json" with { type: "json" };

interface Observation {
  readonly argv: readonly string[];
  readonly stdin: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}
const cases: readonly { id: string; observation: Observation; request: CsvkitRequest }[] = [
  { id: "raw/1 duplicate cuts", observation: raw.cases[1]!, request: { command: "csvcut", settings: { columns: "2,1,2" } } },
  { id: "raw/4 invalid zero column", observation: raw.cases[4]!, request: { command: "csvcut", settings: { columns: "0" } } },
  { id: "raw/25 inverted any match", observation: raw.cases[25]!, request: { command: "csvgrep", settings: { columns: "1,2", pattern: "x", any_match: true, inverse: true } } },
  { id: "raw/30 quoted multiline numbering", observation: raw.cases[30]!, request: { command: "csvgrep", settings: { columns: "1", pattern: "y", line_numbers: true } } },
  { id: "additional/1 short and surplus rows", observation: additional.cases[1]!, request: { command: "csvclean", settings: { length_mismatch: true } } },
  { id: "additional/6 historical join failure", observation: additional.cases[6]!, request: { command: "csvclean", settings: { join_short_rows: true, length_mismatch: true } } },
  { id: "stack/0 line-number collision", observation: stack.cases[0]!, request: { command: "csvstack", settings: { line_numbers: true } } },
  { id: "stack/3 duplicate headings and missing cells", observation: stack.cases[3]!, request: { command: "csvstack", settings: { input_paths: ["a", "b"] } } },
  { id: "stack/6 surplus dictionary key failure", observation: stack.cases[6]!, request: { command: "csvstack", settings: { input_paths: ["a"] } } },
  { id: "join/2 numeric key identity", observation: join.cases[2]!, request: { command: "csvjoin", settings: { sniff_limit: 0, columns: "k", input_paths: ["a", "b"] } } },
  { id: "join/5 historical zero-column failure", observation: join.cases[5]!, request: { command: "csvjoin", settings: { sniff_limit: 0, no_inference: true, zero_based: true, columns: "0", input_paths: ["a", "b"] } } },
  { id: "sort/0 Unicode uppercase expansion", observation: sort.cases[0]!, request: { command: "csvsort", settings: { sniff_limit: 0, no_inference: true, ignore_case: true, columns: "k" } } },
  { id: "sort/1 duplicate selectors and nulls", observation: sort.cases[1]!, request: { command: "csvsort", settings: { sniff_limit: 0, columns: "k,k" } } },
  { id: "look/5 row truncation", observation: look.cases[5]!, request: { command: "csvlook", settings: { sniff_limit: 0, max_rows: 1 } } }
];
const encoder = new TextEncoder();

for (const item of cases) test(`user frozen stream replay ${item.id}`, async () => {
  const observation = item.observation;
  const files = observation.files ?? {};
  const input = encoder.encode(observation.stdin);
  const maxLength = Math.max(input.length, ...Object.values(files).map(text => encoder.encode(text).length));
  for (let split = 0; split <= maxLength + 1; split++) for (const sdk of [false, true]) {
    const volume = Volume.fromJSON(files);
    const before = volume.toJSON();
    let acquired = 0, finalized = 0;
    const source = (bytes: Uint8Array) => ({ async *[Symbol.asyncIterator]() {
      acquired++;
      try {
        yield new Uint8Array();
        if (split <= maxLength) {
          yield bytes.slice(0, split);
          yield new Uint8Array();
          yield bytes.slice(split);
        } else {
          const reusable = new Uint8Array(1);
          for (const byte of bytes) {
            reusable[0] = byte;
            yield reusable;
            reusable[0] = 0xff;
            yield new Uint8Array();
          }
        }
      } finally { finalized++; }
    } });
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const cleanups: (() => Promise<void>)[] = [];
    const context: CsvkitContext = {
      argv: new OwnedArguments(observation.argv.map(arg => encoder.encode(arg)), defaultLimits), cwd: "/",
      fs: {
        readFile: async path => Uint8Array.from(volume.readFileSync(path) as Buffer),
        readStream: path => source(Uint8Array.from(volume.readFileSync(path) as Buffer)),
        writeFile: async () => { assert.fail("unexpected file write"); }
      },
      stdin: source(input), stdinIsDefault: false,
      stdout: { write: async bytes => { stdout.push(Uint8Array.from(bytes)); } },
      stderr: { write: async bytes => { stderr.push(Uint8Array.from(bytes)); } },
      terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
      env: {}, codecs: [utf8Codec], compression: [], databases: [],
      locale: { profile: "C", timezone: "UTC", formatNumber: () => { assert.fail("unexpected locale formatting"); } },
      clock: { now: () => 0 }, limits: defaultLimits, signal: new AbortController().signal,
      registerCleanup: cleanup => { cleanups.push(cleanup); }
    };
    try {
      const status = sdk ? await run(item.request, context) : await execute(item.request.command, context);
      assert.deepEqual({ status, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) },
        { status: observation.status, stdout: Buffer.from(observation.stdout), stderr: Buffer.from(observation.stderr) },
        `${item.id} split=${split} sdk=${sdk}`);
    } finally { for (const cleanup of cleanups) await cleanup(); }
    assert.equal(finalized, acquired, `${item.id}: acquired iterator leak`);
    assert.deepEqual(volume.toJSON(), before, `${item.id}: file bytes or namespace changed`);
  }
});
