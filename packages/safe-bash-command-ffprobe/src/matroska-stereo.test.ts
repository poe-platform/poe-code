import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Original two-frame VP8 Matroska files, verified with native ffprobe 7.0.2.
// Probe these bytes directly: no serializer or remux precedes inspection.
const cases = [
  { name: "none", tag: undefined, sideData: undefined },
  { name: "left_right", tag: "left_right", sideData: [{ side_data_type: "Stereo 3D", type: "side by side", inverted: 0 }] },
  { name: "right_left", tag: "right_left", sideData: [{ side_data_type: "Stereo 3D", type: "side by side", inverted: 1 }] },
  { name: "top_bottom", tag: "top_bottom", sideData: [{ side_data_type: "Stereo 3D", type: "top and bottom", inverted: 0 }] }
];

for (const { name, tag, sideData } of cases) {
  const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/stereo-${name}.mkv`, import.meta.url));
  const args = ["-v", "error", "-show_streams", "-of", "json"];

  it(`reports Matroska ${name} stereo metadata synchronously`, () => {
    const output = evalSyncFfprobe(bytes, [...args, "input.mkv"], () => bytes);
    expect(output).toBeDefined();
    const stream = JSON.parse(output!).streams[0];
    expect(stream.tags?.stereo_mode).toBe(tag);
    expect(stream.side_data_list).toEqual(sideData);
  });

  it.each(["input.mkv", "-"])(`reports original Matroska ${name} stereo metadata from %s`, async target => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.mkv", bytes);
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
    const streams = JSON.parse(output).streams;
    expect(streams).toHaveLength(1);
    expect(streams[0].tags?.stereo_mode).toBe(tag);
    expect(streams[0].side_data_list).toEqual(sideData);
  });
}
