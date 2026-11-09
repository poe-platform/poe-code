import { expect, it } from "vitest";
import { encodeWav, probeWavSource } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";
import { probe } from "./probe.js";
import { SourceAudioTags } from "./source-tags.js";
import { formatTaggedAudio } from "./tag-format.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80)] }, { tags: { title: 'a,b|c"d' } });

for (const writer of ["csv", "csv=nk=1", "csv=nokey=1", "csv=nk=0", "csv=nokey=0"]) {
  const keys = writer.endsWith("=0");
  for (const [selection, expected] of [
    ["packet=size", `packet,${keys ? "size=" : ""}160\n`],
    ["format=duration", `format,${keys ? "duration=" : ""}0.010000\n`],
    ["format_tags=title", `format,${keys ? "tag:title=" : ""}"a,b|c""d"\n`]
  ] as const) {
    it(`preserves literal ${writer} output for ${selection}`, async () => {
      const args = ["-v", "error", "-of", writer, "-show_entries", selection, "/sample.wav"];
      const fs = new MemoryFileSystem();
      await fs.writeFile("/sample.wav", bytes);
      let stdout = "", stderr = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), fs, cwd: "/", env: {},
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, stderr).toBe(0);
      expect(stdout).toBe(expected);
      expect(evalSyncFfprobe(undefined, args, () => bytes)).toBe(expected);
      if (selection !== "packet=size") {
        const audioArgs = args.map(arg => arg === writer ? writer.replace("=", ":") : arg);
        expect(probe(bytes, audioArgs)).toBe(expected);
        const source = { size: bytes.length, async read(offset: number, length: number) { return bytes.slice(offset, offset + length); } };
        const tags = new SourceAudioTags(source, { fs, cwd: "/", env: {}, signal: new AbortController().signal });
        try {
          const audio = await probeWavSource(source, { onTag: span => tags.add(span) });
          let taggedOutput = "";
          for await (const part of formatTaggedAudio(audio, bytes.length, audioArgs, tags)) taggedOutput += part;
          expect(taggedOutput).toBe(expected);
        } finally { await tags.close(); }
      }
    });
  }
}
