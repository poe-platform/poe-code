import assert from "node:assert/strict";
import { it } from "node:test";
import { createCipheriv, createHash } from "node:crypto";
import type { CommandContext } from "safe-bash-contracts/command";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, createFfprobeCommand } from "./index.js";
import native from "../../../tests/fixtures/media/hls-missing.json" with { type: "json" };

for (const probe of [false, true]) {
  for (const extensions of [undefined, "mp4,m4s,key", "ALL", ""]) {
    it(`${probe ? "ffprobe" : "ffmpeg"} decrypts AES-128 HLS with allowed_extensions=${extensions}`, async () => {
      const files: Record<string, Uint8Array> = Object.fromEntries(Object.entries(native.files).map(([path, data]) =>
        [`/${path}`, new Uint8Array(Buffer.from(data, "base64"))]));
      const key = new Uint8Array(16);
      files["/k.key"] = key;
      for (const path of Object.keys(files).filter(path => path.endsWith(".m4s"))) {
        const cipher = createCipheriv("aes-128-cbc", key, new Uint8Array(16));
        files[path] = new Uint8Array(Buffer.concat([cipher.update(files[path]!), cipher.final()]));
      }
      files["/audio.m3u8"] = new TextEncoder().encode(new TextDecoder().decode(files["/audio.m3u8"]).replace("#EXTINF:", '#EXT-X-KEY:METHOD=AES-128,URI="k.key",IV=0x00000000000000000000000000000000\n#EXTINF:'));
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
      assert.equal(result.exitCode, extensions === "" || extensions === undefined ? 1 : 0, errors);
      assert.equal(reads.includes("/k.key"), extensions !== undefined && extensions !== "");
      if (extensions === "" || extensions === undefined) { assert.deepEqual(reads, ["/audio.m3u8"]); return; }
      if (!probe) {
        const packets = parseMp4(files["/output.mp4"]!).tracks[0]!.samples.map(sample => ({
          pts: sample.pts, dts: sample.dts,
          data_hash: `SHA256:${createHash("sha256").update(sample.data).digest("hex")}`
        }));
        assert.deepEqual(packets, native.full);
      }
    });
  }
}
