import assert from "node:assert/strict";
import { it } from "node:test";
import type { CommandContext } from "safe-bash-contracts/command";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, createFfprobeCommand } from "./index.js";

const media = createSyntheticMp4({ width: 16, height: 16, frameCount: 1 });
function fixture(args: string[], files: Record<string, Uint8Array> = { "/in.mp4": media }) {
  const output: Uint8Array[] = [];
  const errors: string[] = [];
  const controller = new AbortController();
  const totals: number[] = [];
  const context = {
    args, cwd: "/", env: {}, signal: controller.signal,
    inputBudget: { check(n: number) { totals.push(n); } },
    stdin: (async function* () { yield media.subarray(0, 10); yield media.subarray(10); })(),
    fs: {
      async readFile(path: string) {
        if (files[path]) return files[path];
        throw Object.assign(new Error(path), { code: "ENOENT" });
      },
      async stat() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
      async writeFile(path: string, bytes: Uint8Array) { files[path] = bytes; },
      async mkdir() {}
    },
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(new TextDecoder().decode(bytes)); } }
  } as unknown as CommandContext;
  return { context, totals, output, errors, files, controller };
}

const encode = (text: string) => new TextEncoder().encode(text);
const master = encode('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=80000\nsub/media.m3u8\n');
const playlist = encode('#EXTM3U\n#EXTINF:1,\n../part.mp4\n');
for (const probe of [false, true]) {
  it(`${probe ? "ffprobe" : "ffmpeg"} follows a local HLS master and accounts for all input`, async () => {
    const f = fixture(probe ? ["-show_streams", "-of", "json", "/hls/master.m3u8"] :
      ["-i", "/hls/master.m3u8", "-c", "copy", "/out.mp4"], {
      "/hls/master.m3u8": master, "/hls/sub/media.m3u8": playlist, "/hls/part.mp4": media
    });
    assert.equal((await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute(f.context)).exitCode, 0, f.errors.join(""));
    assert.equal(f.totals.at(-1), master.length + playlist.length + media.length);
    if (!probe) assert.deepEqual(parseMp4(f.files["/out.mp4"]!).tracks[0]!.samples.map(s => s.data),
      parseMp4(media).tracks[0]!.samples.map(s => s.data));
  });
}
for (const uri of ["missing.m3u8", "https://example.com/media.m3u8", "master.m3u8"]) {
  it(`fails safely for master URI ${uri}`, async () => {
    const f = fixture(["-i", "/hls/master.m3u8", "-c", "copy", "/out.mp4"], {
      "/hls/master.m3u8": encode(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n${uri}\n`)
    });
    assert.equal((await createFfmpegCommand().execute(f.context)).exitCode, 1);
    assert.equal(f.files["/out.mp4"], undefined);
  });
}
it("includes the child playlist in the input limit", async () => {
  const f = fixture(["-i", "/hls/master.m3u8", "-c", "copy", "/out.mp4"], {
    "/hls/master.m3u8": master, "/hls/sub/media.m3u8": playlist, "/hls/part.mp4": media
  });
  assert.equal((await createFfmpegCommand({ limits: { maxInputBytes: master.length + playlist.length - 1 } }).execute(f.context)).exitCode, 1);
  assert.equal(f.files["/out.mp4"], undefined);
});
