import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

function voc(data: Buffer, codec = 4, split = false): Buffer {
  const header = Buffer.from("437265617469766520566f6963652046696c651a1a0014011f11", "hex");
  const info = Buffer.alloc(12);
  info.writeUInt32LE(8000);
  info[4] = codec === 4 ? 16 : 8;
  info[5] = codec === 4 ? 2 : 1;
  info.writeUInt16LE(codec, 6);
  const block = (type: number, bytes: Buffer) => {
    const prefix = Buffer.alloc(4);
    prefix[0] = type;
    prefix.writeUIntLE(bytes.length, 1, 3);
    return Buffer.concat([prefix, bytes]);
  };
  return Buffer.concat([header, block(9, Buffer.concat([info, split ? data.subarray(0, data.length / 2) : data])),
    ...(split ? [block(2, data.subarray(data.length / 2))] : []), Buffer.from([0])]);
}

async function convert(input: Buffer, forced: string[] = []) {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/input", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", ...forced, "-i", "/input", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { code: result.exitCode, stderr, output: volume.readFileSync("/out.raw") };
}

for (const split of [false, true]) for (const forced of [false, true]) {
  it(`decodes stereo PCM16 VOC, continuation=${split}, forced=${forced}`, async () => {
    const pcm = Buffer.alloc(64);
    for (let i = 0; i < 16; i++) {
      pcm.writeInt16LE(72 + 100 * i, i * 4);
      pcm.writeInt16LE(-1024 - 20 * i, i * 4 + 2);
    }
    const result = await convert(voc(pcm, 4, split), forced ? ["-f", "voc"] : []);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.output, pcm);
  });
}
for (const [codec, format] of [[6, "alaw"], [7, "mulaw"]] as const) {
  it(`decodes all ${format} codes across VOC blocks`, async () => {
    const codes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const expected = await convert(codes, ["-f", format, "-ar", "8000", "-ac", "1"]);
    assert.equal(expected.code, 0, expected.stderr);
    for (const forced of [false, true]) {
      const result = await convert(voc(codes, codec, true), forced ? ["-f", "voc"] : []);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(result.output, expected.output);
    }
  });
}
it("rejects corrupt and truncated VOC without modifying the destination", async () => {
  const valid = voc(Buffer.alloc(64));
  const corrupt = Buffer.from(valid);
  corrupt.fill(0, 0, 8);
  for (const bytes of [corrupt, valid.subarray(0, 50)]) for (const forced of [false, true]) {
    const result = await convert(bytes, forced ? ["-f", "voc"] : []);
    assert.equal(result.code, 1);
    assert.equal(result.output.toString(), "keep");
  }
});
