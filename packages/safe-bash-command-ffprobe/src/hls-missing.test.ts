import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfmpegCommand } from "safe-bash-command-ffmpeg";
import { createFfprobeCommand } from "./index.js";
import native from "../../../tests/fixtures/media/hls-missing.json" with { type: "json" };

// Native FFmpeg 9.0.1: sine=f=440:r=48000:d=3 -> AAC -> fMP4 HLS, hls_time=1.
// Packet timestamps and SHA-256 hashes come from native ffprobe of copied MP4s.
for (const missing of [undefined, "audio1.m4s", "init.mp4", "audio.m3u8"]) {
  for (const probe of [false, true]) it(`${probe ? "probes" : "copies"} HLS with missing ${missing}`, async () => {
    const fs = new MemoryFileSystem();
    for (const [uri, data] of Object.entries(native.files)) {
      if (uri !== missing) await fs.writeFile(`/${uri}`, new Uint8Array(Buffer.from(data, "base64")));
    }
    const command = probe ? createFfprobeCommand() : createFfmpegCommand();
    let diagnostic = "";
    let stdout = "";
    const result = await command.execute({
      command: probe ? "ffprobe" : "ffmpeg",
      ...createCommandArguments(probe
        ? ["-show_streams", "-of", "json", "/audio.m3u8"]
        : ["-y", "-i", "/audio.m3u8", "-map", "0:a:0", "-c", "copy", "/output.mp4"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    if (missing === "init.mp4" || missing === "audio.m3u8") {
      expect(result.exitCode).toBe(1);
      expect(diagnostic).toContain("ENOENT");
      await expect(fs.readFile("/output.mp4")).rejects.toMatchObject({ code: "ENOENT" });
      return;
    }
    expect(result.exitCode, diagnostic).toBe(0);
    if (probe) {
      expect(JSON.parse(stdout).streams).toMatchObject([{ codec_type: "audio", codec_name: "aac" }]);
      return;
    }
    const packets = parseMp4(await fs.readFile("/output.mp4")).tracks[0]!.samples.map(sample => ({
        pts: sample.pts, dts: sample.dts,
        data_hash: `SHA256:${createHash("sha256").update(sample.data).digest("hex")}`
      }));
    expect(packets).toEqual(missing ? native.partial : native.full);
  });
}
