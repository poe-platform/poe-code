import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

for (const [fixture, filename, codec, pos] of [
  ["little.sph", "little.sph", "pcm_s16le", "1024"],
  ["big.sph", "big.sph", "pcm_s16be", "2048"],
  ["little.sph", "valid-blob", "pcm_s16le", "1024"],
  ["bad.sph", "bad.sph", "pcm_s16le", "1024"],
  ["bad.sph", "invalid-blob", undefined, undefined],
  ["same.wav", "same.wav", "pcm_s16le", "44"]
] as const) {
  it(`probes NIST reference ${filename} with file-relative packet positions`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(`/${filename}`, readFileSync(new URL(`../../mp4-ast/src/fixtures/nist-${fixture}`, import.meta.url)));
    let output = "", diagnostic = "";
    const args = ["-v", "error", "-show_entries",
      "format=format_name:format_tags:stream=codec_name,channels,sample_rate,duration_ts:packet=pos,pts,size,duration",
      "-of", "json", `/${filename}`];
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, diagnostic).toBe(codec ? 0 : 1);
    if (codec) expect(JSON.parse(output)).toMatchObject({
      packets: [{ pts: 0, duration: 4, size: "16", pos }],
      streams: [{ codec_name: codec, sample_rate: "8000", channels: 2, duration_ts: 4 }],
      format: filename.endsWith(".wav") ? { format_name: "wav" }
        : { format_name: "nistsphere", tags: { speaker_id: "Ada" } }
    });
  });
}
