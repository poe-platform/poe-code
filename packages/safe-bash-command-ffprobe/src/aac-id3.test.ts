import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeId3, id3HeaderSize } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const tagged = readFileSync(new URL("./fixtures/aac-id3.aac", import.meta.url));
const plain = tagged.subarray(id3HeaderSize(tagged));
const v4 = encodeId3({ title: "Meeting", artist: "Alice" }, [], [], 4);
const footerTag = v4.slice();
footerTag[5] = 16;
const footer = footerTag.slice(0, 10);
footer.set([51, 68, 73]);
for (const [name, bytes] of [["plain", plain], ["ID3v2.3", tagged], ["ID3v2.4", Buffer.concat([v4, plain])],
  ["ID3v2.4 footer", Buffer.concat([footerTag, footer, plain])]] as const) {
  for (const route of ["file", "stdin", "sync"]) for (const sections of ["info", "packets", "both"]) {
    it(`recognizes ${name} AAC via ${route}, sections=${sections}`, async () => {
      const args = ["-v", "error", ...(sections !== "packets" ? ["-show_format", "-show_streams"] : []), ...(sections !== "info" ? ["-show_packets"] : []),
        "-of", "json", route === "stdin" ? "-" : "/no-extension"];
      let output = "", diagnostic = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/no-extension", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { for (let at = 0; at < bytes.length; at += 7) yield bytes.subarray(at, at + 7); } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
      }
      const result = JSON.parse(output);
      if (sections !== "packets") {
        expect(result.format.format_name).toBe("aac");
        expect(result.streams[0].codec_name).toBe("aac");
        expect(result.format.tags ?? {}).toEqual(name === "plain" ? {} : {
          title: "Meeting", artist: "Alice", ...(name === "ID3v2.3" ? { encoder: "Lavf61.1.100" } : {})
        });
      }
      if (sections !== "info") expect(result.packets).toHaveLength(16);
    });
  }
}
