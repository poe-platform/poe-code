import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(value: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  const channels = Array.from({ length: 2 }, (_, c) => Float64Array.from({ length: 512 },
    (_, i) => (((2 * i + c) * 13129) % 30001 - 15000) / 32768));
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  const filter = `surround=win_size=1024:lfe=${value}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.pcm") as Buffer };
}

// Native FFmpeg 7.0.2 hashes for the same 512 stereo PCM16 frames at 8 kHz.
for (const [values, hash] of [
  [["0", "false", "no", "off", "n", "disabled", "N", "DISABLED"],
    "c1a3da15c94e9ad8b25a299132e029df92b95263fe9e65b6ae52b61404a0127b"],
  [["1", "true", "yes", "on", "y", "enabled", "Y", "ENABLED"],
    "550746aadb7678511bce97d51278657234b327196c68034b132807ede73503d7"]
] as const) for (const value of values) for (const graph of [false, true]) {
  it(`surround lfe=${value} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, output } = await run(value, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, 6144);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

for (const graph of [false, true]) {
  it(`surround rejects invalid LFE without replacing output (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, output } = await run("invalid", graph);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("surround: invalid lfe"), stderr);
    assert.equal(output.toString(), "keep");
  });
}
