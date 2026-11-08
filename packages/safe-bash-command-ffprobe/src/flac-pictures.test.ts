import { expect, it } from "vitest";
import { writeAudioMetadata } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const art = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEklEQVR4nGP8w4AdsOAQH6QSANBkARqrv8JBAAAAAElFTkSuQmCC", "base64"));
for (const count of [0, 1, 2]) for (const route of ["file", "stdin"]) for (const explicit of [false, true]) {
  it(`discovers ${count} FLAC attached pictures through ${route} and synchronous probing (explicit=${explicit})`, async () => {
    const header = new Uint8Array(42);
    header.set([102, 76, 97, 67, 128, 0, 0, 34]);
    new DataView(header.buffer).setBigUint64(18, (16000n << 44n) | (15n << 36n) | 16000n);
    const bytes = writeAudioMetadata(header, { title: "Recording" }, { pictures: Array.from({ length: count }, (_, index) => ({
      type: 3, mime: "image/png", description: `Cover ${index}`, data: art
    })) });
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.flac", bytes);
    for (const selection of [[], ["-select_streams", "v:0"]]) {
      const args = [...(explicit ? ["-f", "flac"] : []), "-v", "quiet", "-show_streams", "-show_format", "-of", "json", ...selection, route === "file" ? "/input.flac" : "-"];
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {
          const borrowed = new Uint8Array(7);
          for (let pos = 0; pos < bytes.length; pos += 7) {
            const chunk = bytes.subarray(pos, pos + 7); borrowed.set(chunk); yield borrowed.subarray(0, chunk.length);
          }
        } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const probe = JSON.parse(output);
      if (!explicit && !selection.length) expect(probe.format.tags).toMatchObject({ TITLE: "Recording" });
      expect(probe.format.nb_streams).toBe(count + 1);
      expect(probe.streams).toHaveLength(selection.length ? Math.min(count, 1) : count + 1);
      if (!selection.length) expect(probe.streams[0]).toMatchObject({ index: 0, codec_name: "flac", codec_type: "audio" });
      for (const stream of probe.streams.filter((stream: { codec_type: string }) => stream.codec_type === "video")) {
        expect(stream).toMatchObject({ codec_name: "png", width: 8, height: 8, disposition: { attached_pic: 1 }, tags: { title: `Cover ${stream.index - 1}`, comment: "Cover (front)" } });
      }
      expect(output).toBe(evalSyncFfprobe(route === "stdin" ? bytes : undefined, args, () => bytes));
    }
  });
}
