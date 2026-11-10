import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({
  sampleRate: 8000,
  channels: Array.from({ length: 2 }, (_, channel) =>
    Float64Array.from({ length: 1536 }, (_, i) => ((i * 421 + channel * 1709) % 12000 - 6000) / 32768))
});

async function run(filter: string, graph: boolean) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/in.wav", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

for (const graph of [false, true]) {
  for (const [phase, positional, canonical, hash] of [
    ["middle_phase", "1:1:1:mid:", "1", "ea6d180cdf45f35936228d809c4b51df3ec54595bcbc6435e154c026f49185e7"],
    ["left_phase", "1:1:1:mid:0:2.05:-1:1:", "1", "78adef2e4d0a81c85525827fc2e719b053dc5a5e81cc2ce5f10d6848923abee0"],
    ["right_phase", "1:1:1:mid:0:2.05:-1:1:0:2.12:1:1:", "0", "90ccb1099f6c72f73d872dbf8142d9c1a20f68fec8efd35f5f7bcf91baf33ecf"]
  ] as const) {
    for (const prefix of [`${phase}=`, positional]) {
      it(`haas ${graph ? "graph" : "simple"} ${prefix} accepts native boolean spellings`, async () => {
        for (const [value, aliases] of [
          ["1", ["true", "TrUe", "YES", "On", "y", "Y", "enable", "EnAbLeD", "enabled", "+1", "01"]],
          ["0", ["false", "FaLsE", "NO", "Off", "n", "N", "disable", "DiSaBlEd", "disabled", "-0", "00"]]
        ] as const) {
          const expected = await run(`haas=${prefix}${value}`, graph);
          assert.equal(expected.result.exitCode, 0, expected.stderr);
          assert.equal(expected.output.length, 6144);
          // Native FFmpeg 7.0.2 PCM16 output for the deterministic stereo input above.
          if (value === canonical) assert.equal(createHash("sha256").update(expected.output).digest("hex"), hash);
          for (const alias of aliases) {
            const actual = await run(`haas=${prefix}${alias}`, graph);
            assert.equal(actual.result.exitCode, 0, `${alias}: ${actual.stderr}`);
            assert.ok(actual.output.equals(expected.output), `${alias}: PCM differs`);
          }
        }
      });

      it(`haas ${graph ? "graph" : "simple"} ${prefix} rejects invalid booleans without replacing output`, async () => {
        for (const value of ["maybe", "auto", "2", "-1", "1.0", "0x1", "truejunk"]) {
          const actual = await run(`haas=${prefix}${value}`, graph);
          assert.equal(actual.result.exitCode, 1, value);
          assert.ok(actual.stderr.includes(`haas: ${phase} must be in the range [0, 1]`), actual.stderr);
          assert.equal(actual.output.toString(), "KEEP", value);
        }
      });
    }
  }
}
