import { expect, it } from "vitest";
import { createSyntheticMp4, parseMp4, serializeMpegTs } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

it("reports MPEG-TS PIDs without changing stream indices or MP4 IDs", async () => {
  const mp4 = createSyntheticMp4({ width: 16, height: 16, frameCount: 1, includeAudio: true });
  const ts = serializeMpegTs(parseMp4(mp4));
  for (const [filename, bytes, streams] of [
    ["/input.ts", ts, [{ index: 0, id: "0x100", codec_name: "h264" }, { index: 1, id: "0x101", codec_name: "aac" }]],
    ["/input.mp4", mp4, [{ index: 0, id: "0x1", codec_name: "h264" }, { index: 1, id: "0x2", codec_name: "aac" }]]
  ] as const) {
    const args = ["-v", "error", "-show_entries", "stream=index,id,codec_name", "-of", "json", filename];
    const fs = new MemoryFileSystem();
    await fs.writeFile(filename, bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    for (const text of [output, evalSyncFfprobe(undefined, args, () => bytes)!]) {
      expect(JSON.parse(text).streams).toEqual(streams);
    }
  }
});
