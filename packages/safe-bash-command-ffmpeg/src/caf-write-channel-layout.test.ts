import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Four-channel PCM fixture from the CAF reproduction, with distinct samples.
const input = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000080000000100000004000000106368616e000000000000000c006c0004000000000000000064617461000000000000000c00000000640038ff2c0170fe", "hex");

for (const sync of [false, true]) {
  for (const [channels, tag, expected] of [[4, 0x006c0004, 0x00840004], [4, 0x00840004, 0x00840004], [1, 0x00640001, 0x00640001], [2, 0x00650002, 0x00650002], [4, 0xffff0004, undefined]] as const) {
    it(`writes CAF layout ${tag} on stream copy (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      const source = Buffer.from(input);
      source.writeUInt32BE(channels * 2, 36);
      source.writeUInt32BE(channels, 44);
      source.writeUInt32BE(tag, 64);
      volume.writeFileSync("/in.caf", source);
      const args = ["-v", "error", "-y", "-i", "/in.caf", "-c:a", "copy", "/out.caf"];
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
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.caf") as Buffer;
      let layout: number | undefined;
      let pcm: Buffer | undefined;
      for (let offset = 8; offset < output.length;) {
        const id = output.toString("ascii", offset, offset + 4);
        const size = Number(output.readBigInt64BE(offset + 4));
        const start = offset + 12;
        if (id === "chan") {
          assert.equal(size, 12);
          layout = output.readUInt32BE(start);
          assert.equal(output.readBigUInt64BE(start + 4), 0n);
        }
        if (id === "data") pcm = output.subarray(start + 4, start + size);
        offset = start + size;
      }
      assert.equal(layout, expected);
      assert.equal(output.readUInt32BE(44), channels);
      assert.deepEqual(pcm, input.subarray(-8));
    });
  }
}
