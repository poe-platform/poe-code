import assert from "node:assert/strict";
import { it } from "node:test";
import { cafAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = Buffer.from("0102fcff03040708", "hex");

for (const sync of [false, true]) {
  for (const [channels, tag, expected] of [[1, "inferred", 0x00640001], [2, "inferred", 0x00650002], [4, "inferred", 0x00730004], [2, "stereo", 0x00650002], [4, "quad", 0x00840004], [2, "disabled", undefined]] as const) {
    if (sync && (tag === "quad" || tag === "disabled")) continue;
    it(`writes CAF ${channels}-channel layout ${tag} from raw PCM (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      const source = input.subarray(0, channels * 2);
      const args = ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", String(channels),
        ...(tag === "disabled" ? ["-guess_layout_max", "0"] : tag === "inferred" ? [] : ["-channel_layout", tag]),
        "-i", sync ? "/in.raw" : "pipe:0", "-fflags", "+bitexact", "-f", "caf", "/out.caf"];
      if (sync) {
        volume.writeFileSync("/in.raw", source);
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
          stdin: (async function* () { for (const byte of source) yield Uint8Array.of(byte); })(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
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
      assert.equal(cafAst().parse(output).tracks[0]?.codecDescriptions[0]?.channelLayout,
        tag === "disabled" ? undefined : tag === "quad" ? "quad(side)" : channels === 1 ? "mono" : channels === 2 ? "stereo" : "4.0");
      assert.equal(output.readUInt32BE(44), channels);
      assert.deepEqual(pcm, Buffer.from(source).swap16());
    });
  }
}
