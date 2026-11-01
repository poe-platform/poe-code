import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(800)] });

it("reports audio metadata for a plain ffprobe invocation", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/tone.wav", wav);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["/tone.wav"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(output).toContain("codec_name=pcm_s16le");
  expect(output).toContain("sample_rate=8000");
  expect(output).toContain("duration=0.100000");
});

it("keeps synchronous default audio probes consistent with media probes", () => {
  const output = evalSyncFfprobe(undefined, ["/tone.wav"], () => wav);
  expect(output).toContain("codec_name=pcm_s16le");
  expect(output).toContain("duration=0.100000");
});
