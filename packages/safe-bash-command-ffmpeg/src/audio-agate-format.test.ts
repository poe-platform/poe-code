import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 references for stereo PCM16 input, including a unity gate.
for (const [filter, format, hash] of [
  ["agate", "dbl", "080a910cf94a6c0fb40d244fbad9515d2ac1d1d14176886ba64b35076e9c06dc"],
  ["agate=ratio=1", "dbl", "94d9ade717f48bd07308b581795d047819ea986aac4d9bfcc93fd6764c336ce3"],
  ["aformat=sample_fmts=dbl,agate", "dbl", "080a910cf94a6c0fb40d244fbad9515d2ac1d1d14176886ba64b35076e9c06dc"],
  ["aformat=sample_fmts=dblp,agate", "dbl", "080a910cf94a6c0fb40d244fbad9515d2ac1d1d14176886ba64b35076e9c06dc"],
  ["anull", "s16", "94d9ade717f48bd07308b581795d047819ea986aac4d9bfcc93fd6764c336ce3"]
] as const) for (const graph of [false, true]) {
  it(`${filter} exposes ${format} frames and preserves native PCM16 output (${graph ? "graph" : "simple"})`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/out.raw", Buffer.from("KEEP"));
    const channels = [
      Float64Array.from({ length: 6400 }, (_, i) => ((i * 131) % 4001 - 2000) * [1, 6, 2, 0][Math.floor(i / 512) % 4]! / 32768),
      Float64Array.from({ length: 6400 }, (_, i) => ((i * 47) % 1801 - 900) * [2, 1, 16, 0][Math.floor(i / 512) % 4]! / 32768)
    ];
    await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000, channels }));
    const errors: Uint8Array[] = [];
    const argumentValues = createCommandArguments(["-hide_banner", "-loglevel", "info", "-y", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter},ashowinfo[out]`, "-map", "[out]"] : ["-af", `${filter},ashowinfo`]),
      "-f", "s16le", "/out.raw"]);
    const result = await createFfmpegCommand().execute({
      command: "ffmpeg", args: argumentValues.args, argumentValues,
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    });
    const stderr = Buffer.concat(errors).toString();
    assert.equal(result.exitCode, 0, stderr);
    const output = await fs.readFile("/out.raw");
    assert.equal(output.length, 25600);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    const frames = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"));
    assert.ok(frames.length > 0, stderr);
    for (const frame of frames) {
      assert.ok(frame.includes(`fmt:${format} channels:2 chlayout:stereo rate:8000 `), frame);
      const checksum = frame.split(" checksum:")[1]!.split(" ")[0];
      assert.ok(frame.endsWith(`plane_checksums: [ ${checksum} ]`), frame);
    }
  });
}
