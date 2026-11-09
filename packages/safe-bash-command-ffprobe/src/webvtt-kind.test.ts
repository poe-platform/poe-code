import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const kind of ["subtitles", "captions", "descriptions", "metadata"]) {
  const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/webvtt-${kind}.webm`, import.meta.url));
  const args = ["-v", "error", "-select_streams", "s:0", "-show_entries",
    "stream=codec_name,codec_type:stream_disposition=captions,descriptions,metadata", "-of", "json", "/in.webm"];
  const expected = { programs: [], stream_groups: [], streams: [{ codec_name: "webvtt", codec_type: "subtitle", disposition: {
    captions: Number(kind === "captions"), descriptions: Number(kind === "descriptions"), metadata: Number(kind === "metadata")
  } }] };

  it(`probes native WebVTT ${kind} with its disposition synchronously`, () => {
    expect(JSON.parse(evalSyncFfprobe(bytes, args, () => bytes)!)).toEqual(expected);
  });

  it(`probes native WebVTT ${kind} with its disposition asynchronously`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.webm", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output)).toEqual(expected);
  });
}
