import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createSyntheticMp4, parseMp4, probeMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe reports signed counterclockwise angles for these MP4 matrices.
const cases = [
  { matrix: [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824], rotation: 90 },
  { matrix: [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824], rotation: -90 },
  { matrix: [-65536, 0, 0, 0, -65536, 0, 0, 0, 1073741824], rotation: -180 },
  { matrix: [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824], rotation: undefined }
];

for (const { matrix, rotation } of cases) {
  const base = parseMp4(createSyntheticMp4({ width: 32, height: 16, frameCount: 1, includeAudio: false }));
  const bytes = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, rotation: undefined, matrix })) });
  const expected = rotation === undefined ? undefined : [expect.objectContaining({ side_data_type: "Display Matrix", rotation })];
  const args = ["-v", "error", "-show_streams", "-of", "json", "turn.mp4"];

  it(`reports native rotation ${rotation} through resident probes`, () => {
    expect(probeMp4(bytes).streams[0]?.side_data_list).toEqual(expected);
    const output = evalSyncFfprobe(bytes, args, () => bytes);
    expect(output).toBeDefined();
    expect(JSON.parse(output!).streams[0].side_data_list).toEqual(expected);
  });

  it(`reports native rotation ${rotation} through the source-backed command`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/turn.mp4", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(diagnostic).toBe("");
    expect(JSON.parse(output).streams[0].side_data_list).toEqual(expected);
  });
}
