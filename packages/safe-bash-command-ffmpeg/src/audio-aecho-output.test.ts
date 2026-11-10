import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: only the zero-sample configuration failure opens output.
for (const [filter, exitCode, hex] of [
  ["aecho=0.5:0.5:0.01:0.5", 234, ""],
  ["aecho=0.5:0.4:1|2:0.25", undefined, "4b454550"],
  ["aecho=0.5:0.5:0.125:0.5", 0, "a00fa00f0000000030f830f8000000000000"]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} leaves native PCM output bytes (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(filter, ["-y"], true, graph);
      if (exitCode === undefined) assert.notEqual(result.exitCode, 0, stderr);
      else assert.equal(result.exitCode, exitCode, stderr);
      assert.equal((volume.readFileSync("/out.pcm") as Buffer).toString("hex"), hex);
    });
  }
}

for (const overwrite of [[], ["-n"]]) {
  for (const existing of [false, true]) {
    it(`zero-sample echo preserves output without explicit overwrite (${overwrite[0] ?? "default"}, existing=${existing})`, async () => {
      const { volume, result } = await run("aecho=0.5:0.5:0.01:0.5", overwrite, existing);
      if (!existing || overwrite.length === 0) assert.notEqual(result.exitCode, 0);
      assert.equal(volume.existsSync("/out.pcm"), existing);
      if (existing) assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
    });
  }
}

for (const [format, target] of [["null", "/out.pcm"], ["s16le", "-"], ["s16le", "/dev/null"], ["s16le", "md5:/out.pcm"]]) {
  it(`zero-sample echo does not write a file for ${format} ${target}`, async () => {
    const { volume, result } = await run("aecho=0.5:0.5:0.01:0.5", ["-y"], true, false, format, target);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
    assert.deepEqual(volume.readdirSync("/"), ["in.wav", "out.pcm"]);
  });
}

async function run(filter: string, overwrite: string[], existing: boolean, graph = false, format = "s16le", target = "/out.pcm") {
  const volume = Volume.fromJSON(existing ? { "/out.pcm": "KEEP" } : {});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from([16000, 0, 0, 0, -8000, 0, 0, 0], sample => sample / 32768)
  ] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: [...overwrite, "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", format, target],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}
