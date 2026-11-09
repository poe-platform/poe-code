import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Synthetic mono AAC tones; control.m4a remuxes the 48 kHz ADTS payloads.
// Expected metadata and counts were compared with native ffprobe.
for (const [fixture, sampleRate, count] of [
  ["44100.aac", 44100, 11], ["48000.aac", 48000, 12], ["control.m4a", 48000, 12]
] as const) for (const route of ["file", "stream", "stdin", "sync"]) {
  for (const counted of [false, true]) {
    it(`reports container metadata for ${fixture} via ${route}, counted=${counted}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/adts-metadata-${fixture}`, import.meta.url));
      const args = ["-v", "error", "-show_streams",
        ...(counted ? ["-count_frames", "-count_packets"] : []),
        "-of", "json", route === "stdin" ? "-" : "/input"];
      let output = "", diagnostic = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes)!;
      else {
        const base = new MemoryFileSystem();
        await base.writeFile("/input", bytes);
        const capabilities = { ...base.capabilities, retainedRead: false, streamingRead: true };
        const fs = route === "stream" ? new Proxy(base, { get(target, key) {
          if (key === "capabilities") return capabilities;
          if (key === "capabilitiesFor") return async () => capabilities;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } }) : base;
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() {
            for (let offset = 0; offset < bytes.length; offset += 71) yield bytes.subarray(offset, offset + 71);
          } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
      }
      const { streams } = JSON.parse(output);
      expect(streams).toHaveLength(1);
      const stream = streams[0];
      expect(stream).toMatchObject({ codec_name: "aac", profile: "LC", sample_rate: String(sampleRate) });
      if (fixture.endsWith(".aac")) {
        expect(stream).toMatchObject({
          codec_tag_string: "[0][0][0][0]", codec_tag: "0x0000", disposition: { default: 0 }
        });
        expect(stream).not.toHaveProperty("id");
        expect(stream).not.toHaveProperty("tags");
        expect(stream).not.toHaveProperty("nb_frames");
      } else {
        expect(stream).toMatchObject({
          codec_tag_string: "mp4a", codec_tag: "0x6134706d", id: "0x1",
          disposition: { default: 1 }, tags: { language: "und" }, nb_frames: String(count)
        });
      }
      if (counted) expect(stream).toMatchObject({ nb_read_frames: String(count), nb_read_packets: String(count) });
      else {
        expect(stream).not.toHaveProperty("nb_read_frames");
        expect(stream).not.toHaveProperty("nb_read_packets");
      }
    });
  }
}
