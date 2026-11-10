import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph: boolean) {
  const input = Buffer.alloc(4096 * 2);
  for (let i = 0; i < 4096; i++) input.writeInt16LE(((i % 32) - 16) * 800, i * 2);
  const fs = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "info", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out"],
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
  return { pcm: fs.readFileSync("/out") as Buffer, stderr };
}

// FFmpeg 7.0.2, mono PCM16 at 8 kHz: round(input frame samples / tempo).
// Non-unity PCM blending is separate from these frame size/timestamp checks.
for (const graph of [false, true]) {
  for (const [tempo, count] of [[2, 256], [1.5, 341], [0.5, 1024], [1, 512]] as const) {
    for (const n of [0, 1]) {
      it(`atempo=${tempo} emits frame ${n} with ${count} samples (${graph ? "graph" : "simple"})`, async () => {
        const { pcm, stderr } = await run(`atempo=${tempo},aselect='eq(n,${n})',ashowinfo`, graph);
        assert.equal(pcm.length, count * 2);
        const frames = stderr.split("\n").filter(line => line.includes("nb_samples:"));
        assert.equal(frames.length, 1, stderr);
        assert.ok(frames[0]!.includes(`pts:${n * count} pts_time:${n * count / 8000} `), stderr);
        assert.ok(frames[0]!.includes(`nb_samples:${count} `), stderr);
        if (tempo === 1) assert.equal(createHash("sha256").update(pcm).digest("hex"),
          "b6f51081be1a46f9cd7866a78a1fe423bbf2d03c17b4e19fd6deca2189d63f60");
      });
    }
  }

  for (const [filter, count, pts] of [
    ["asetpts=PTS+800,atempo=2,aselect='eq(t,0.132)'", 256, 1056],
    ["asetnsamples=n=300:p=0,atempo=1.5,aselect='eq(n,0)'", 200, 0],
    ["atempo=2,atempo=2,aselect='eq(n,0)'", 128, 0]
  ] as const) {
    it(`atempo uses its incoming frame size and starting timestamp: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const { pcm, stderr } = await run(`${filter},ashowinfo`, graph);
      assert.equal(pcm.length, count * 2);
      assert.ok(stderr.includes(`pts:${pts} pts_time:${pts / 8000} `), stderr);
      assert.ok(stderr.includes(`nb_samples:${count} `), stderr);
    });
  }

  it(`atempo=2 retains the complete 2048-sample output (${graph ? "graph" : "simple"})`, async () => {
    const { pcm } = await run("atempo=2", graph);
    assert.equal(pcm.length, 2048 * 2);
  });
}
