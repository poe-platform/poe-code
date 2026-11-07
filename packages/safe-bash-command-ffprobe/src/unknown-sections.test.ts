import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });

for (const target of ["/input.wav", "-"]) {
  it.each(["notasection=size", "notasection=", "notasection", "packet=size:notasection=size"])(
    `diagnoses unknown sections before publishing output from ${target}: %s`, async entries => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.wav", bytes);
      let stdout = "", stderr = "";
      const args = ["-v", "error", "-of", "json", "-show_entries", entries, target];
      await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect(stdout).toBe("");
      expect(stderr).toContain("No match for section 'notasection'");
      expect(stderr).toContain(`Failed to set value '${entries}' for option 'show_entries': Invalid argument`);
      expect(evalSyncFfprobe(bytes, args, () => bytes)).toBeUndefined();
    }
  );
}

it.each(["packet", "frame", "chapter", "program", "stream_side_data", "packet_tags"])(
  "keeps valid explicitly empty %s selections", section => {
    expect(JSON.parse(evalSyncFfprobe(bytes, ["-of", "json", "-show_entries", `${section}=`, "-"])!)).toEqual({});
  }
);
