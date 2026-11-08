import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [format, expected] of Object.entries({
  hash: "SHA256=dcd6333cac77dfdf3ad50d64fc85f05a5982f9f4752c3bf498cba9e7b79fe39c\n",
  md5: "MD5=344d44d28d60f19a337cb5682352d8e5\n",
  crc: "CRC=0x1f750594\n",
  streamhash: "0,v,SHA256=dcd6333cac77dfdf3ad50d64fc85f05a5982f9f4752c3bf498cba9e7b79fe39c\n"
})) {
  it(`computes ${format} over video frame payloads without headers`, async () => {
    const payloads = [Buffer.from("103050708090", "hex"), Buffer.from("90b0d0eb4048", "hex")];
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W2 H2 F2:1 Ip A1:1 C420jpeg\n"),
      ...payloads.flatMap(payload => [Buffer.from("FRAME\n"), payload])
    ]);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.y4m", input);
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-f", format, "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(output).toString(), expected);
  });
}
