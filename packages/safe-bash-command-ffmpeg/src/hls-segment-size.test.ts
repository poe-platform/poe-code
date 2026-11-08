import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const type of ["mpegts", "fmp4"]) {
  for (const windowed of [false, true]) {
    it(`rolls ${type} byte ranges into numbered files (windowed=${windowed})`, async () => {
      const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 1, frameCount: 4, includeAudio: false }));
      const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({ ...track,
        samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
      })) });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      const run = async (extra: string[]) => {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_list_size", windowed ? "1" : "0",
            "-hls_segment_type", type, ...extra, "/out.m3u8"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); },
            async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
            async rm(path: string) { volume.unlinkSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        return String(volume.readFileSync("/out.m3u8")).trim().split("\n");
      };
      const ext = type === "fmp4" ? "m4s" : "ts";
      await run([]);
      const segments = [0, 1, 2, 3].map(i => Buffer.from(volume.readFileSync(`/out${i}.${ext}`)));
      const size = segments[0]!.length + 1;
      const lines = await run(["-hls_segment_size", String(size), "-hls_segment_filename", `/part%03d.${ext}`, "-start_number", "5", "-hls_flags", "delete_segments"]);
      assert.ok(lines.includes(`#EXT-X-VERSION:${type === "fmp4" ? 7 : 4}`));
      assert.deepEqual(volume.readFileSync(`/part005.${ext}`), Buffer.concat(segments.slice(0, 2)));
      assert.deepEqual(volume.readFileSync(`/part006.${ext}`), Buffer.concat(segments.slice(2)));
      const ranges = lines.flatMap((line, i) => line.startsWith("#EXT-X-BYTERANGE:") ? [{ range: line.slice(17), uri: lines[i + 1]! }] : []);
      assert.equal(ranges.length, windowed ? 1 : 4);
      for (const [i, entry] of ranges.entries()) {
        const index = windowed ? 3 : i;
        const [length, offset] = entry.range.split("@").map(Number) as [number, number];
        assert.equal(entry.uri, `part00${5 + Math.floor(index / 2)}.${ext}`);
        assert.equal(offset, index % 2 ? segments[index - 1]!.length : 0);
        assert.deepEqual(Buffer.from(volume.readFileSync(`/${entry.uri}`)).subarray(offset, offset + length), segments[index]);
      }
      const single = await run(["-hls_segment_size", "1", "-hls_flags", "single_file"]);
      assert.ok(single.includes(`out.${ext}`));
      const disabled = await run(["-hls_segment_size", "0"]);
      assert.ok(disabled.every(line => !line.startsWith("#EXT-X-BYTERANGE:")));
    });
  }
}

for (const value of [undefined, "", "-1", "1.5", "NaN", "2147483648"]) {
  it(`rejects invalid hls_segment_size ${value}`, async () => {
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hls_segment_size", ...(value === undefined ? [] : [value])],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {}, stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("invalid hls_segment_size"), stderr);
  });
}
