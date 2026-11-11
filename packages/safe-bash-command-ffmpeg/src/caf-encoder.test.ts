import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const bitexact of [false, true]) {
    for (const tagged of [false, true]) {
      it(`writes CAF encoder metadata (${sync ? "sync" : "chunked stdin"}, bitexact=${bitexact}, tagged=${tagged})`, async () => {
        const input = Buffer.from("0102fcff", "hex");
        const volume = Volume.fromJSON({ "/in.raw": input });
        const args = ["-v", "error", "-y", "-f", "s16le", "-ar", "8000",
          "-ac", "2", "-channel_layout", "stereo", "-i", sync ? "/in.raw" : "pipe:0",
          ...(bitexact ? ["-fflags", "+bitexact"] : []),
          ...(tagged ? ["-metadata", "title=Title", "-metadata", "artist=Artist", "-metadata", "album=Record", "-metadata", "comment=Note"] : []),
          "-f", "caf", "/out.caf"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () { for (const byte of input) yield Uint8Array.of(byte); })(),
            stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        const output = volume.readFileSync("/out.caf") as Buffer;
        const tags: Record<string, string> = {};
        const chunks: string[] = [];
        let pcm: Buffer | undefined;
        for (let offset = 8; offset < output.length;) {
          const id = output.toString("ascii", offset, offset + 4);
          chunks.push(id);
          const size = Number(output.readBigInt64BE(offset + 4));
          const start = offset + 12;
          if (id === "info") {
            const strings = output.toString("utf8", start + 4, start + size).split("\0");
            for (let i = 0; i < output.readUInt32BE(start); i++) tags[strings[i * 2]!] = strings[i * 2 + 1]!;
          }
          if (id === "data") pcm = output.subarray(start + 4, start + size);
          offset = start + size;
        }
        assert.deepEqual(tags, {
          ...(!bitexact ? { encoder: "Lavf61.7.100" } : {}),
          ...(tagged ? { title: "Title", artist: "Artist", album: "Record", comment: "Note" } : {})
        });
        assert.equal(chunks.includes("info"), !bitexact || tagged);
        if (!sync) assert.ok(chunks.includes("chan"));
        assert.deepEqual(pcm, Buffer.from(input).swap16());
      });
    }
  }
}
