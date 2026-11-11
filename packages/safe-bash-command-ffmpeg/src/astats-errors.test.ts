import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 rejects these options before emitting PCM or statistics.
for (const [filter, status] of [
  ["astats=bogus=1", 8],
  ["astats=reset=-1", 222],
  ["astats=reset=2147483648", 222],
  ["astats=reset=nope", 234],
  ["astats=metadata=bogus", 234],
  ["astats=enable=1", 176],
  ["astats=measure_perchannel=none:measure_overall=Max_level|Number_of_samples", 234]
] as const) for (const graph of [false, true]) for (const output of ["-", "/out.pcm"]) {
  it(`${filter} returns ${status} without audio (${graph ? "graph" : "simple"}, ${output})`, async () => {
    const volume = Volume.fromJSON({ "/out.pcm": "keep existing output" });
    const samples = new Float64Array(2400);
    samples.fill(0.5, 2000);
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments([
      "-hide_banner", "-nostats", "-v", "info", "-y", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", output
    ]);
    const result = await createFfmpegCommand().execute({
      args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(Buffer.concat(stdout).length, 0);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep existing output");
    assert.ok(stderr.includes("astats:"), stderr);
    assert.ok(!stderr.includes("Channel:") && !stderr.includes("Overall\n"), stderr);
    assert.equal(result.exitCode, status, stderr);
  });
}
