import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import type { CommandContext } from "safe-bash-contracts/command";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, createFfprobeCommand } from "./index.js";
import native from "../../../tests/fixtures/media/hls-missing.json" with { type: "json" };

for (const probe of [false, true]) {
  for (const extensions of [undefined, "mp4,m4s,txt", "ALL", ""]) {
    it(`${probe ? "ffprobe" : "ffmpeg"} applies HLS allowed_extensions=${extensions}`, async () => {
      const files: Record<string, Uint8Array> = Object.fromEntries(Object.entries(native.files).map(([path, data]) =>
        [`/${path}`, new Uint8Array(Buffer.from(data, "base64"))]));
      files["/audio.m3u8"] = new TextEncoder().encode(new TextDecoder().decode(files["/audio.m3u8"]).replace("audio1.m4s", "note.txt"));
      files["/note.txt"] = files["/audio1.m4s"]!;
      const reads: string[] = [];
      let errors = "";
      const options = extensions === undefined ? [] : ["-allowed_extensions", extensions];
      const context = {
        args: probe ? [...options, "-show_streams", "-of", "json", "/audio.m3u8"] :
          [...options, "-i", "/audio.m3u8", "-c", "copy", "/output.mp4"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        fs: {
          async readFile(path: string) { reads.push(path); if (files[path]) return files[path]; throw Object.assign(new Error(path), { code: "ENOENT" }); },
          async stat() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
          async writeFile(path: string, bytes: Uint8Array) { files[path] = bytes; },
          async mkdir() {}
        },
        stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors += new TextDecoder().decode(bytes); } }
      } as unknown as CommandContext;
      const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute(context);
      assert.equal(result.exitCode, extensions === "" ? 1 : 0, errors);
      assert.equal(reads.includes("/note.txt"), extensions !== undefined && extensions !== "");
      if (extensions === "") { assert.deepEqual(reads, ["/audio.m3u8"]); return; }
      if (!probe) {
        const packets = parseMp4(files["/output.mp4"]!).tracks[0]!.samples.map(sample => ({
          pts: sample.pts, dts: sample.dts,
          data_hash: `SHA256:${createHash("sha256").update(sample.data).digest("hex")}`
        }));
        assert.deepEqual(packets, extensions === undefined ? native.partial : native.full);
      }
    });
  }
}

for (const ranged of [false, true]) {
  it(`skips disallowed standalone segments before reading${ranged ? " byte ranges" : ""} and resets the next input policy`, async () => {
    const media = createSyntheticMp4({ width: 16, height: 16, frameCount: 1 });
    const playlist = new TextEncoder().encode(`#EXTM3U\n#EXTINF:1,\n${ranged ? "#EXT-X-BYTERANGE:10@5\n" : ""}note.txt\n#EXTINF:1,\npart.MP4\n#EXT-X-ENDLIST\n`);
    const files: Record<string, Uint8Array> = { "/first.m3u8": new TextEncoder().encode("#EXTM3U\n#EXTINF:1,\nnote.txt\n"),
      "/second.m3u8": playlist, "/note.txt": media, "/part.MP4": media };
    const reads: string[] = [];
    let errors = "";
    const result = await createFfmpegCommand().execute({
      args: ["-allowed_extensions", "ALL", "-i", "/first.m3u8", "-i", "/second.m3u8", "-map", "1:v", "-c", "copy", "/output.mp4"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      fs: {
        async readFile(path: string) { reads.push(path); return files[path]!; },
        async stat() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
        async writeFile(path: string, bytes: Uint8Array) { files[path] = bytes; },
        async mkdir() {}
      },
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors += new TextDecoder().decode(bytes); } }
    } as unknown as CommandContext);
    assert.equal(result.exitCode, 0, errors);
    assert.equal(reads.filter(path => path === "/note.txt").length, 1);
    assert.equal(parseMp4(files["/output.mp4"]!).tracks[0]!.samples.length, 1);
  });
}
