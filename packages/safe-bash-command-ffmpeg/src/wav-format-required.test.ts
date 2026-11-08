import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, createFfprobeCommand } from "./index.js";

function fixture(formatLength: number | undefined, afterData = false): Buffer {
  const chunk = (id: string, bytes: Buffer) => {
    const head = Buffer.alloc(8); head.write(id); head.writeUInt32LE(bytes.length, 4);
    return Buffer.concat([head, bytes, Buffer.alloc(bytes.length % 2)]);
  };
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1); format.writeUInt16LE(1, 2);
  format.writeUInt32LE(8000, 4); format.writeUInt32LE(8000, 8);
  format.writeUInt16LE(1, 12); format.writeUInt16LE(8, 14);
  const fmt = formatLength === undefined ? Buffer.alloc(0) : chunk("fmt ", format.subarray(0, formatLength));
  const data = chunk("data", Buffer.from([128, 129, 130, 131]));
  const body = Buffer.concat([Buffer.from("WAVE"), chunk("JUNK", Buffer.from("xyz")), ...(afterData ? [data, fmt] : [fmt, data])]);
  const head = Buffer.alloc(8); head.write("RIFF"); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

for (const length of [undefined, 0, 10, 14, 16]) for (const pipe of [false, true]) {
  it(`validates format length ${length} before output (${pipe ? "pipe" : "file"})`, async () => {
    const input = fixture(length, true);
    const valid = length !== undefined && length >= 14;
    const volume = Volume.fromJSON({ "/out.wav": "sentinel" });
    volume.writeFileSync("/in.wav", input);
    for (const probe of [false, true]) {
      let stderr = "";
      const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute({
        args: probe
          ? ["-v", "error", "-show_packets", "-show_entries", "stream=codec_name,sample_rate,channels,bits_per_sample,duration_ts:packet=pos,size,duration", "-of", "json", pipe ? "pipe:0" : "/in.wav"]
          : ["-y", "-v", "error", "-i", pipe ? "pipe:0" : "/in.wav", "-c:a", "copy", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { if (pipe) yield input; })(),
        stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode === 0, valid, stderr);
      if (!valid) assert.equal(volume.readFileSync("/out.wav", "utf8"), "sentinel");
    }
  });
}
