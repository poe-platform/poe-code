import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

it("preserves native CAF packet boundaries in stream-copy framecrc output", async () => {
  const header = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d0000000000000002000000010000000100000010646174610000000000002ee400000000", "hex");
  const pcm = Buffer.alloc(12000);
  for (let offset = 0; offset < pcm.length; offset += 8) {
    pcm.writeInt16BE(100, offset);
    pcm.writeInt16BE(-200, offset + 2);
    pcm.writeInt16BE(300, offset + 4);
    pcm.writeInt16BE(-400, offset + 6);
  }
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.caf", Buffer.concat([header, pcm]));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.caf", "-c:a", "copy", "-f", "framecrc", "/out.txt"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const rows = volume.readFileSync("/out.txt", "utf8").toString().split("\n")
    .filter(line => line && !line.startsWith("#"))
    .map(line => line.split(",").map(field => field.trim()));
  // Native FFmpeg 7.0.2: stream, DTS, PTS, duration, size, CRC.
  assert.deepEqual(rows, [
    ["0", "0", "0", "2048", "4096", "0xd6be6c5a"],
    ["0", "2048", "2048", "2048", "4096", "0xd6be6c5a"],
    ["0", "4096", "4096", "1904", "3808", "0xf6bff8b3"]
  ]);
});
