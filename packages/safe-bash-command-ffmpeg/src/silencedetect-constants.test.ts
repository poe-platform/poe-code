import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(noise: string, duration: string, input: Buffer, graph = false) {
  const fs = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
  const filter = `silencedetect=${noise}:d=${duration}`;
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(fs.readFileSync("/out.raw"), input);
  return stderr.trim().split("\n").map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line).filter(line => line.includes("silence_"));
}

// Captured with native FFmpeg 7.0.2 using the same s16le input and filter arguments.
for (const graph of [false, true]) {
  for (const key of ["n=", "noise=", ""]) {
    for (const noise of ["E/30", "PHI/20", "default", "min", "max", "0.09817477"]) {
      it(`silencedetect ${key}${noise} matches native silence intervals (graph=${graph})`, async () => {
        const input = Buffer.from("004000000000000000000040000000000000", "hex");
        assert.deepEqual(await run(`${key}${noise}`, "0.00025", input, graph),
          noise === "min" || noise === "max" ? [] : [
            "silence_start: 0.000125",
            "silence_end: 0.000625 | silence_duration: 0.0005",
            "silence_start: 0.00075",
            "silence_end: 0.001125 | silence_duration: 0.000375"
          ]);
      });
    }
  }
  it(`silencedetect PI/32 matches native zero-duration intervals (graph=${graph})`, async () => {
    const input = Buffer.from("004000000000000000000040000000000000", "hex");
    assert.deepEqual(await run("n=PI/32", "0", input, graph), [
      "silence_start: 0.00025",
      "silence_end: 0.000625 | silence_duration: 0.000375",
      "silence_start: 0.000875",
      "silence_end: 0.001125 | silence_duration: 0.00025"
    ]);
  });
}

for (const [noise, expected] of [
  ["E/30", [
    "silence_start: 0.000125", "silence_end: 0.000625 | silence_duration: 0.0005",
    "silence_start: 0.00075", "silence_end: 0.000875 | silence_duration: 0.000125"
  ]],
  ["PHI/20", ["silence_start: 0.000125", "silence_end: 0.0005 | silence_duration: 0.000375"]],
  ["PI/32", [
    "silence_start: 0.000125", "silence_end: 0.000625 | silence_duration: 0.0005",
    "silence_start: 0.00075", "silence_end: 0.001 | silence_duration: 0.00025"
  ]],
  ["default", ["silence_start: 0.000125", "silence_end: 0.00025 | silence_duration: 0.000125"]],
  ["min", []],
  ["max", []],
  ["max/max", ["silence_start: 0", "silence_end: 0.001125 | silence_duration: 0.001125"]]
] as const) {
  it(`silencedetect ${noise} uses the native threshold for nonzero PCM`, async () => {
    const samples = [16384, 16, 65, 2621, 2785, 16384, 2949, 3113, 3277];
    const input = Buffer.alloc(samples.length * 2);
    samples.forEach((value, index) => input.writeInt16LE(value, index * 2));
    assert.deepEqual(await run(`n=${noise}`, "0.000125", input), expected);
  });
}
