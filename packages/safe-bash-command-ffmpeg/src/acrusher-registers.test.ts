import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: eight PCM16 samples of 300 at 8 kHz, mono.
for (const complex of [false, true]) {
  for (const filter of [
    "acrusher=level_in=0.5",
    "acrusher=level_in=st(0\\,0.5)",
    "acrusher=level_in=ld(0)+0.5",
    "acrusher=level_in='st(0,0.25);ld(0)*2'",
    "acrusher=st(9\\,0.5)",
    "acrusher=level_in='st(9,0.25)+ld(9)'",
    "acrusher=level_in=st(0\\,0.5):level_out=ld(0)+1",
    "acrusher=level_in=st(0\\,0.25):level_in=ld(0)+0.5",
    "asendcmd=c='0 acrusher level_in ld(0)+0.5',acrusher=level_in=st(0\\,0.25)"
  ]) {
    it(`evaluates fresh acrusher option registers: ${filter} (${complex ? "graph" : "simple"})`, async () => {
      const { result, stderr, samples } = await run(filter, complex);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(samples, Array<number>(8).fill(139));
    });
  }

  it(`uses fresh acrusher registers for runtime commands (${complex ? "graph" : "simple"})`, async () => {
    const { result, stderr, samples } = await run(
      "asetnsamples=4:0,asendcmd=c='0 acrusher level_in ld(0)+0.25;0.0005 acrusher level_in ld(0)+0.5',acrusher=level_in=st(0\\,0.5)", complex);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(samples, [86, 86, 86, 86, 139, 139, 139, 139]);
  });

  it(`rejects out-of-range acrusher register values without replacing output (${complex ? "graph" : "simple"})`, async () => {
    const { result, stderr, samples, volume } = await run("acrusher=level_in=st(0\\,65)", complex, "/out.pcm");
    assert.equal(result.exitCode, 222, stderr);
    assert.deepEqual(samples, []);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
  });
}

async function run(filter: string, complex: boolean, output = "pipe:1") {
  const input = Buffer.alloc(16);
  for (let offset = 0; offset < input.length; offset += 2) input.writeInt16LE(300, offset);
  const volume = Volume.fromJSON({ "/in.pcm": input, "/out.pcm": "keep" });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
      ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  const stdout = Buffer.concat(chunks);
  const samples = Array.from({ length: stdout.length / 2 }, (_, index) => stdout.readInt16LE(index * 2));
  return { result, stderr, samples, volume };
}
