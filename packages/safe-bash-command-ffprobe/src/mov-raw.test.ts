import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native fixture: 72 bytes (i * 7 + 11) % 256, encoded with:
// ffmpeg -f rawvideo -pixel_format rgb24 -video_size 3x2 -framerate 5
// -i rgb.raw -c:v rawvideo -pix_fmt rgb24 raw-rgb24.mov
// Expected metadata and packets verified with native ffprobe on these same bytes.
for (const mode of ["file", "stdin", "sync"]) {
  it(`reports QuickTime raw RGB video via ${mode}`, async () => {
    const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/raw-rgb24.mov", import.meta.url));
    const args = ["-v", "error", "-show_entries",
      "stream=codec_name,pix_fmt,width,height,avg_frame_rate:packet=pts,size",
      "-of", "json", mode === "file" ? "/clip.mov" : "-"];
    let output = "", diagnostic = "";
    if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
    else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/clip.mov", bytes);
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
    }
    expect(JSON.parse(output)).toMatchObject({
      streams: [{ codec_name: "rawvideo", pix_fmt: "rgb24", width: 3, height: 2, avg_frame_rate: "5/1" }],
      packets: [0, 2048, 4096, 6144].map(pts => ({ pts, size: "20" }))
    });
  });
}
