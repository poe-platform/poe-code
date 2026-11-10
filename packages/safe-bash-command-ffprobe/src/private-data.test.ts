import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));
for (const [switches, enabled] of [
  [[], true],
  [["-private"], true],
  [["-show_private_data"], true],
  [["-noprivate"], false],
  [["-noshow_private_data"], false],
  [["-noprivate", "-show_private_data"], true],
  [["-private", "-noshow_private_data"], false],
] as const) {
  for (const mode of ["file", "stdin", "sync"]) {
    for (const writer of ["default=nw=1", "json"]) {
      it(`honors ${switches.join(" ") || "default private fields"} via ${mode} with ${writer}`, async () => {
        const args = ["-v", "error", ...switches, "-show_entries", "stream=codec_name,is_avc,nal_length_size", "-of", writer, mode === "file" ? "/clip.mp4" : "-"];
        let output = "", diagnostic = "";
        if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/clip.mp4", bytes);
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
          });
          expect(result.exitCode, diagnostic).toBe(0);
          expect(diagnostic).toBe("");
        }
        if (writer === "json") expect(JSON.parse(output).streams).toEqual([
          { codec_name: "h264", ...(enabled ? { is_avc: "true", nal_length_size: "4" } : {}) }
        ]);
        else expect(output).toBe("codec_name=h264\n" + (enabled ? "is_avc=true\nnal_length_size=4\n" : ""));
      });
    }
  }
}
