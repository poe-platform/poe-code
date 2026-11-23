import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2: input copy seeks retain the overlapping packet;
// output copy seeks discard packets beginning before the requested time.
for (const [code, channels, inputOffset, outputOffset] of [[0, 1, 0, 2048], [0, 2, 2048, 4096], [4, 1, 2048, 4096], [4, 2, 4096, 6144]] as const) {
  for (const split of [false, true]) for (const inputSeek of [false, true]) {
    it(`seeks VOC code=${code} channels=${channels} split=${split} at ${inputSeek ? "input" : "output"}`, async () => {
      const block = (type: number, data: Buffer) => {
        const prefix = Buffer.alloc(4); prefix[0] = type; prefix.writeUIntLE(data.length, 1, 3);
        return Buffer.concat([prefix, data]);
      };
      const data = Buffer.from(Array.from({length:10000}, (_, i) => i * 29 + 3));
      const info = Buffer.alloc(12); info.writeUInt32LE(8000); info[4] = code === 4 ? 16 : 8;
      info[5] = channels; info.writeUInt16LE(code, 6);
      const source = Buffer.concat([Buffer.from("437265617469766520566f6963652046696c651a1a0014011f11", "hex"),
        block(9, Buffer.concat([info, split ? data.subarray(0, 5000) : data])),
        ...(split ? [block(2, data.subarray(5000))] : []), Buffer.from([0])]);
      const volume = Volume.fromJSON({"/input":source,"/output":"keep"});
      const args = ["-v", "error", "-y", ...(inputSeek ? ["-ss", "0.13"] : []), "-i", "/input",
        ...(inputSeek ? [] : ["-ss", "0.13"]), "-c:a", "copy", "-f", code === 4 ? "s16le" : "u8", "/output"];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd:"/", env:{}, signal:new AbortController().signal,
        fs:{async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }},
        stdin:(async function* () {})(), stdout:{async write() {}},
        stderr:{async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); }}
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const expected = data.subarray(inputSeek ? inputOffset : split && code === 4 && channels === 2 ? 5000 : outputOffset);
      assert.deepEqual(volume.readFileSync("/output"), expected);
      if (!inputSeek) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        assert.deepEqual(volume.readFileSync("/output"), expected);
      }
    });
  }
}
