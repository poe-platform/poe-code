import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { mp4Ast, serializeMp4, wavAst } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Mono PCM WAV with a LIST/INFO title; native ffprobe reports both flags as zero.
const bytes = Buffer.from("524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000", "hex");

for (const flag of ["default", "forced"]) for (const target of ["/simple.wav", "-"]) for (const explicit of [false, true]) {
  it(`reports zero WAV ${flag} disposition from ${target} (explicit WAV: ${explicit}) through async and sync probing`, async () => {
    const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), "-of", "default", "-show_entries", `stream_disposition=${flag}`, target];
    const expected = `[STREAM]\nDISPOSITION:${flag}=0\n[/STREAM]\n`;
    const fs = new MemoryFileSystem();
    await fs.writeFile("/simple.wav", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (target === "-") yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(diagnostic).toBe("");
    expect(output).toBe(expected);
    expect(evalSyncFfprobe(target === "-" ? bytes : undefined, args, () => bytes)).toBe(expected);
  });
}

it("reports zero WAV dispositions through the media API and JSON disposition output", () => {
  expect(wavAst().probe(bytes).streams[0]!.disposition).toMatchObject({ default: 0, forced: 0 });
  const output = evalSyncFfprobe(bytes, ["-show_entries", "stream_disposition=default,forced", "-of", "json", "-"]);
  expect(JSON.parse(output!).streams[0].disposition).toMatchObject({ default: 0, forced: 0 });
});

it("preserves the default disposition when WAV audio is muxed into MP4", () => {
  const mp4 = serializeMp4(wavAst().parse(bytes));
  expect(mp4Ast().probe(mp4).streams[0]!.disposition.default).toBe(1);
});
