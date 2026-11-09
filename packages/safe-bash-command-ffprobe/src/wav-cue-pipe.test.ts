import { expect, it } from "vitest";
import { probeWavSource, probeWavStream, wavAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Four PCM samples followed by INFO/title, cue ID 12, and its adtl label.
const after = Buffer.from("524946468800000057415645666d74201000000001000100401f0000803e00000200100064617461080000006400c8002c0190014c49535412000000494e464f494e414d0600000068656c6c6f00637565201c000000010000000c00000002000000646174610000000000000000020000004c495354160000006164746c6c61626c090000000c000000746573740000", "hex");

for (const before of [false, true]) {
  const bytes = before ? Buffer.concat([after.subarray(0, 36), after.subarray(52), after.subarray(36, 52)]) : after;
  for (const input of ["/in.wav", "pipe:0", "-"]) {
    it(`ffprobe imports ${before ? "leading" : "trailing"} cues from ${input}`, async () => {
      const args = ["-v", "error", "-show_format", "-show_chapters", "-of", "json", input];
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.wav", bytes);
      let stdout = "", stderr = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {
          for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
        } },
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode, stderr).toBe(0);
      for (const output of [stdout, evalSyncFfprobe(input === "/in.wav" ? undefined : bytes, args, () => bytes)!]) {
        const chapters = JSON.parse(output).chapters;
        expect(chapters.map(({ id }: { id: number }) => id)).toEqual(before || input === "/in.wav" ? [12] : []);
        if (chapters.length) expect(chapters[0].tags).toEqual({ title: "test" });
      }
    });
  }
  for (const seekable of [false, true]) {
    it(`keeps ${before ? "leading" : "trailing"} cues consistent across WAV readers (seekable=${seekable})`, async () => {
      const results = [
        wavAst().probe(bytes, { seekable }),
        await probeWavSource({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } }, { seekable }),
        await probeWavStream((async function* () {
          for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
        })(), { seekable })
      ];
      for (const result of results) expect(result.chapters?.map(chapter => chapter.id) ?? []).toEqual(before || seekable ? [12] : []);
    });
  }
}

for (const seekable of [false, true]) {
  it(`imports a trailing label only on a seekable WAV (seekable=${seekable})`, async () => {
    const bytes = Buffer.concat([after.subarray(0, 36), after.subarray(52, 114), after.subarray(36, 52), after.subarray(114)]);
    const result = await probeWavStream((async function* () { yield bytes; })(), { seekable });
    expect(result.chapters?.map(chapter => chapter.id)).toEqual([12]);
    expect(result.chapters?.[0]?.tags?.title ?? "").toBe(seekable ? "test" : "");
  });
}
