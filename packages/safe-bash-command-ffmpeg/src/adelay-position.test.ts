import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.raw") as Buffer };
}

// Native FFmpeg 7.0.2 PCM references, including the delayed tail.
for (const graph of [false, true]) {
  for (const enable of ["eq(pos,0)", "eq(w,0)*eq(h,0)", "eq(n,0)"]) {
    it(`adelay exposes the first packet position and audio dimensions: ${enable} (graph ${graph})`, async () => {
      const input = Buffer.alloc(12);
      [101, -901, 202, -802, 303, -703].forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const { result, stderr, output } = await run(input, `adelay=1S:enable='${enable}'`, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
        [0, -901, 101, -802, 202, -703, 303, 0]);
    });
  }

  for (const [enable, hash] of [
    ["gt(pos,0)", "82c059c60bc294cc2ce15ba043c9053e60082d5f57c8947414d32ac95920da03"],
    ["gte(n,1)", "82c059c60bc294cc2ce15ba043c9053e60082d5f57c8947414d32ac95920da03"],
    ["eq(pos,2048)", "693089871de51c32d08a1542be2e7e8a30a347d76876a76bd1263a268fd59b8f"]
  ]) {
    it(`adelay uses each packet's byte offset: ${enable} (graph ${graph})`, async () => {
      const input = Buffer.alloc(1800 * 4);
      for (let i = 0; i < 1800; i++) {
        input.writeInt16LE(i + 1, i * 4);
        input.writeInt16LE(-i - 1, i * 4 + 2);
      }
      const { result, stderr, output } = await run(input, `adelay=2S:enable='${enable}'`, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 1802 * 4);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }

  it(`adelay rejects unknown timeline variables without replacing output (graph ${graph})`, async () => {
    const { result, stderr, output } = await run(Buffer.alloc(12), "adelay=1S:enable='bogus'", graph);
    assert.equal(result.exitCode, 1, stderr);
    assert.ok(stderr.includes("adelay"), stderr);
    assert.equal(output.toString(), "KEEP");
  });
}
