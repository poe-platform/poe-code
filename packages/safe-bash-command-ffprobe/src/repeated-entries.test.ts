import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";
import { parseArguments } from "./probe.js";

for (const mode of ["file", "stdin", "sync"]) {
  for (const separate of [false, true]) {
    it.each([
      ["packet=size", "packet=pts"],
      ["packet=size,pts", "packet="],
      ["packet=", "packet=size,pts"],
      ["packet=size,pts", "packet=size"],
      ["packet", "packet=pts"],
      ["packet=pts", "packet"]
    ])(`accumulates entries via ${mode} with separate arguments=${separate}: %s + %s`, async (first, second) => {
      const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
      const selections = separate ? ["-show_entries", first, "-show_entries", second] : ["-show_entries", `${first}:${second}`];
      const args = ["-v", "error", "-of", "json", ...selections, mode === "file" ? "/tone.wav" : "-"];
      let output = "";
      if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/tone.wav", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
        });
        expect(result.exitCode).toBe(0);
      }
      const result = JSON.parse(output);
      if (second === "packet") {
        expect(result).toEqual(JSON.parse(evalSyncFfprobe(bytes, ["-of", "json", "-show_packets", "-"])!));
      } else if (first === "packet") {
        expect(result).toEqual({ packets: [{ pts: 0 }] });
      } else {
        expect(result).toEqual({ packets: [{ pts: 0, size: "32" }] });
      }
    });
  }
}

const taggedWav = Uint8Array.from(Buffer.from(
  "524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000",
  "hex"
));

for (const mode of ["file", "stdin", "sync"]) {
  for (const separate of [false, true]) {
    for (const writer of ["default", "json"]) {
      const filename = mode === "stdin" ? "-" : "simple.wav";
      it.each([
        ["format=filename", "format=size",
          { format: { filename, ...(mode === "stdin" ? {} : { size: "86" }) } },
          `[FORMAT]\nfilename=${filename}\nsize=${mode === "stdin" ? "N/A" : "86"}\n[/FORMAT]\n`],
        ["stream=codec_name", "stream=",
          { programs: [], stream_groups: [], streams: [{ codec_name: "pcm_s16le" }] },
          "[STREAM]\ncodec_name=pcm_s16le\n[/STREAM]\n"],
        ["stream=index", "stream=codec_name",
          { programs: [], stream_groups: [], streams: [{ index: 0, codec_name: "pcm_s16le" }] },
          "[STREAM]\nindex=0\ncodec_name=pcm_s16le\n[/STREAM]\n"],
        ["format_tags=title", "format_tags=",
          { format: { tags: { title: "Title" } } },
          "[FORMAT]\nTAG:title=Title\n[/FORMAT]\n"]
      ] as const)(`accumulates metadata via ${mode}/${writer} with separate arguments=${separate}: %s + %s`, async (first, second, json, text) => {
        const selections = separate ? ["-show_entries", first, "-show_entries", second] : ["-show_entries", `${first}:${second}`];
        const args = ["-v", "error", "-of", writer, ...selections, filename];
        let output = "";
        if (mode === "sync") output = evalSyncFfprobe(undefined, args, () => taggedWav)!;
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/simple.wav", taggedWav);
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { yield taggedWav; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
          });
          expect(result.exitCode).toBe(0);
        }
        if (writer === "json") expect(JSON.parse(output)).toEqual(json);
        else expect(output).toBe(text);
      });
    }
  }
}

for (const section of ["format", "stream", "format_tags", "stream_tags"]) {
  it.each([
    ["title", "artist", ["title", "artist"]],
    ["title", "", ["title"]],
    ["", "title", ["title"]],
    ["title", "title", ["title"]],
    [undefined, "title", ["title"]],
    ["title", undefined, undefined]
  ] as const)(`accumulates ${section} selections: %s + %s`, (first, second, expected) => {
    const entries = [first, second].map(fields => fields === undefined ? section : `${section}=${fields}`);
    expect(parseArguments(["-show_entries", entries.join(":"), "simple.wav"]).sections.get(section)).toEqual(expected);
  });
}
