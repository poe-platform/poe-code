import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 references, including startup and unchanged controls.
for (const [chain, hash] of [
  ["asendcmd=c=0 apsyclip@c level_out 0.5,apsyclip@c=iterations=1", "6950769d6374cd082d2fc7610196f4faf9a3a16c1eb495a48e4303f7a9e6c95c"],
  ["asendcmd=c=0.032 apsyclip@c level_out 0.5,apsyclip@c=iterations=1", "00703052f7f7cd8686563aedc1c3fd4068a23510bff70a1c4a508aa048f7ba68"],
  ["asendcmd=c=0 apsyclip@c diff 1,apsyclip@c=iterations=1", "13fdf35032a792035c873733b9aa46f22820b75a199a83a40a21f6f3e1ab240f"],
  ["asendcmd=c=0.032 apsyclip@c diff 1,apsyclip@c=iterations=1", "d3f251dd7f2cb8d92e755f706c0b9509e09c23003eec6532e6f041c58fbbd615"],
  ["asendcmd=c=0.032 apsyclip@other diff 1,apsyclip@c=iterations=1", "cf2ed9698023fde697a5b4708e01463f4fe3e2ba837402eb4a400da1d696cf3f"],
  ["asendcmd=c='0 apsyclip@c level_out 0.5;0.032 apsyclip@c level_out 65;0.032 apsyclip@c diff 2',apsyclip@c=iterations=1", "6950769d6374cd082d2fc7610196f4faf9a3a16c1eb495a48e4303f7a9e6c95c"],
  ["apsyclip@c=iterations=1:level_out=0.5", "6950769d6374cd082d2fc7610196f4faf9a3a16c1eb495a48e4303f7a9e6c95c"],
  ["apsyclip@c=iterations=1:diff=1", "13fdf35032a792035c873733b9aa46f22820b75a199a83a40a21f6f3e1ab240f"],
  ["apsyclip@c=iterations=1", "cf2ed9698023fde697a5b4708e01463f4fe3e2ba837402eb4a400da1d696cf3f"]
]) for (const graph of [false, true]) {
  it(`apsyclip matches native ${chain} (graph=${graph})`, async () => {
    for (let repeat = 0; repeat < 3; repeat++) {
      const fs = createMemoryFileSystem();
      const input = Buffer.alloc(1030);
      for (let i = 0; i < 515; i++) input.writeInt16LE((i * 557) % 14001 - 7000, i * 2);
      await fs.writeFile("/in.raw", input);
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const filter = `asetnsamples=n=64:p=0,${chain}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write(chunk) { chunks.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      assert.equal(result.exitCode, 0, stderr);
      const output = Buffer.concat(chunks);
      assert.equal(output.length, 1030);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    }
  });
}
