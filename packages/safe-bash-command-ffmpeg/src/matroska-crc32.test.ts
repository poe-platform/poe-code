import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { crc32 } from "node:zlib";
import { Volume } from "memfs";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const source = readFileSync(new URL("../../mp4-ast/src/fixtures/vp9-alpha.webm", import.meta.url));

function elements(bytes: Buffer, start = 0, end = bytes.length) {
  const result: { id: number; start: number; data: number; end: number }[] = [];
  const vint = (offset: number, size: boolean) => {
    let length = 1;
    while ((bytes[offset]! & (0x80 >> (length - 1))) === 0) length++;
    assert.ok(length <= 8);
    let value = size ? bytes[offset]! & (0xff >> length) : bytes[offset]!;
    for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i]!;
    return { value, length };
  };
  while (start < end) {
    const id = vint(start, false);
    const size = vint(start + id.length, true);
    const data = start + id.length + size.length;
    assert.ok(data + size.value <= end);
    result.push({ id: id.value, start, data, end: data + size.value });
    start = data + size.value;
  }
  return result;
}

for (const sync of [false, true]) {
  for (const format of ["mkv", "webm"]) {
    for (const value of [undefined, "1", "0", "invalid"]) {
      it(`${sync ? "sync" : "async"} ${format} write_crc32=${value} preserves packets or rejects invalid options`, async () => {
        const output = `/out.${format}`;
        const volume = Volume.fromJSON({ "/in.webm": source, [output]: "keep" });
        const args = ["-y", "-i", "/in.webm", "-c", "copy", "-metadata", "artist=CRC test",
          ...(value === undefined ? [] : ["-write_crc32", value]), output];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, data) => { volume.writeFileSync(path, data); return true; }), value === "invalid" ? undefined : "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode, value === "invalid" ? 1 : 0, stderr);
        }
        const bytes = volume.readFileSync(output) as Buffer;
        if (value === "invalid") {
          assert.equal(bytes.toString(), "keep");
          return;
        }
        const segment = elements(bytes).find(element => element.id === 0x18538067)!;
        const parents = elements(bytes, segment.data, segment.end);
        for (const id of [0x1549a966, 0x1654ae6b, 0x1254c367, 0x1f43b675]) {
          assert.ok(parents.some(parent => parent.id === id));
        }
        for (const parent of parents) {
          const checksums = elements(bytes, parent.data, parent.end).filter(child => child.id === 0xbf);
          assert.equal(checksums.length, format === "mkv" && value !== "0" ? 1 : 0);
          for (const checksum of checksums) {
            assert.equal(checksum.start, parent.data);
            assert.equal(checksum.end - checksum.data, 4);
            assert.equal(bytes.readUInt32LE(checksum.data), crc32(bytes.subarray(checksum.end, parent.end)));
          }
        }
        const packets = (bytes: Uint8Array) => parseMkv(bytes).tracks.map(track => track.samples.map(sample => ({
          pts: sample.pts, data: sample.data, isKeyframe: sample.isKeyframe
        })));
        assert.deepEqual(packets(bytes), packets(source));
      });
    }
  }
}
