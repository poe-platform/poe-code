import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg fixture: 18 AAC packets, title=Meeting, artist=Alice.
const input = readFileSync(new URL("./fixtures/adts-ape.m4a", import.meta.url));
const packets = parseMp4(input).tracks.find(track => track.type === "audio")!.samples;

for (const sync of [false, true]) {
  for (const write of [undefined, "0", "1", "bad"]) {
    it(`ADTS trailing APE metadata: sync=${sync}, write=${write}`, async () => {
      const volume = Volume.fromJSON({ "/in.m4a": input, "/out.aac": "keep" });
      const args = ["-v", "error", "-y", "-i", "/in.m4a", "-c:a", "copy",
        ...(write === undefined ? [] : ["-write_apetag", write]), "/out.aac"];
      if (sync) {
        const error = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(error === "", write !== "bad", error);
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, write === "bad" ? 1 : 0, stderr);
      }
      const output = volume.readFileSync("/out.aac") as Buffer;
      if (write === "bad") { assert.equal(output.toString(), "keep"); return; }
      let offset = 0;
      assert.equal(packets.length, 18);
      for (const packet of packets) {
        assert.equal(output[offset], 255);
        const size = ((output[offset + 3]! & 3) << 11) | (output[offset + 4]! << 3) | (output[offset + 5]! >> 5);
        assert.deepEqual(output.subarray(offset + 7, offset + size), Buffer.from(packet.data));
        offset += size;
      }
      if (write !== "1") { assert.equal(offset, output.length); return; }
      const header = output.subarray(offset, offset + 32);
      const footer = output.subarray(-32);
      for (const block of [header, footer]) {
        assert.equal(block.toString("ascii", 0, 8), "APETAGEX");
        assert.equal(block.readUInt32LE(8), 2000);
        assert.equal(block.readUInt32LE(12), output.length - offset - 32);
        assert.deepEqual(block.subarray(24), Buffer.alloc(8));
      }
      assert.equal(header.readUInt32LE(20), 0xa0000000);
      assert.equal(footer.readUInt32LE(20), 0x80000000);
      const tags: Record<string, string> = {};
      offset += 32;
      for (let i = 0; i < footer.readUInt32LE(16); i++) {
        const size = output.readUInt32LE(offset);
        assert.equal(output.readUInt32LE(offset + 4), 0);
        const end = output.indexOf(0, offset + 8);
        const key = output.toString("ascii", offset + 8, end);
        offset = end + 1;
        tags[key] = output.toString("utf8", offset, offset + size);
        offset += size;
      }
      assert.equal(offset, output.length - 32);
      assert.equal(tags.title, "Meeting");
      assert.equal(tags.artist, "Alice");
    });
  }
}
