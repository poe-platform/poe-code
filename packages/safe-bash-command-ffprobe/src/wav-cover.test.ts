import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/wav-cover.wav", import.meta.url));
for (const cover of [false, true]) for (const route of ["file", "stdin"]) for (const explicit of [false, true]) {
  it(`probes WAV attached artwork (${cover}) via ${route}, explicit=${explicit}`, async () => {
    const bytes = cover ? input : Buffer.concat([input.subarray(0, 36), input.subarray(160)]);
    if (!cover) bytes.writeUInt32LE(bytes.length - 8, 4);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.wav", bytes);
    const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), "-select_streams", "v", "-show_entries",
      "stream=index,codec_name,width,height:stream_disposition=attached_pic:stream_tags", "-of", "json", route === "file" ? "/input.wav" : "-"];
    let output = "", stderr = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, stderr).toBe(0);
    const expected = cover ? [{ index: 1, codec_name: "png", width: 3, height: 2,
      disposition: { attached_pic: 1 }, tags: { title: "Front", comment: "Cover (front)" } }] : [];
    expect(JSON.parse(output).streams).toEqual(expected);
    expect(JSON.parse(evalSyncFfprobe(route === "stdin" ? bytes : undefined, args, () => bytes)!).streams).toEqual(expected);
  });
}
