import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 8192 mono PCM16 samples of 8192 at 8 kHz.
for (const [filter, hash] of [
  ["tremolo=f=5", "8ff0c38a6a7a8e50efbb134de6948918426ed3cb2c977c9831fa396143b596de"],
  ["tremolo=5:0.25", "5f2f0db23738d76e49fd8838b7ad19edc9824742093ca157edf110aec41757d1"],
  ["tremolo=f=5:d=1", "0517546525d7d18e5a6f4148f4e976747c46d1c78e86bf0450d517df520682fb"]
] as const) {
  for (const separator of ["", ":"]) {
    for (const graph of [false, true]) {
      it(`${filter}${separator} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
        const { volume, result, stderr } = await run(filter + separator, graph);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(pcm.length, 16384);
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      });
    }
  }
}

for (const graph of [false, true]) {
  it(`rejects two trailing separators without replacing output (${graph ? "graph" : "simple"})`, async () => {
    const { volume, result, stderr } = await run("tremolo=f=5::", graph);
    assert.equal(result.exitCode, 234, stderr);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

async function run(filter: string, graph: boolean) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/tone.wav", encodeWav({
    sampleRate: 8000, channels: [new Float64Array(8192).fill(8192 / 32768)]
  }, { bitsPerSample: 16 }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/tone.wav", ...(graph
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
  return { volume, result, stderr };
}
