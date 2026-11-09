import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { auAst } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe results for the original PCM16 and float64 AU inputs.
for (const [encoding, codec, hex] of [
  [3, "pcm_s16be", "2e736e6400000018000000080000000300001f4000000001000101fffc1903e8"],
  [7, "pcm_f64be", "2e736e6400000018000000200000000700001f40000000013fd0000000000000bfe00000000000003ff4000000000000bff8000000000000"]
] as const) {
  const bytes = Buffer.from(hex, "hex");
  const expected = { codec_name: codec, sample_rate: "8000", channels: 1, duration_ts: 4,
    codec_tag: `0x000${encoding}`, codec_tag_string: `[${encoding}][0][0][0]` };
  const args = ["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels,duration_ts,codec_tag,codec_tag_string", "-of", "json"];

  it(`reports AU encoding ${encoding} through the media API and synchronous command`, () => {
    expect(auAst().probe(bytes).streams[0]).toMatchObject(expected);
    expect(JSON.parse(evalSyncFfprobe(bytes, [...args, "pipe:0"])!).streams).toEqual([expected]);
  });

  it.each(["/in.au", "-"])(`reports AU encoding ${encoding} from %s`, async target => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.au", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments([...args, target]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (target === "-") yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(diagnostic).toBe("");
    expect(JSON.parse(output).streams).toEqual([expected]);
  });
}
