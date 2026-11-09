import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Original VP8 Matroska inputs; expected records verified with native ffprobe 7.0.2.
const cases = [
  { name: "flat", sideData: undefined },
  { name: "sphere", sideData: [{ side_data_type: "Spherical Mapping", projection: "equirectangular", yaw: 0, pitch: 0, roll: 0 }] },
  { name: "tilted", sideData: [{ side_data_type: "Spherical Mapping", projection: "equirectangular", yaw: 35, pitch: -15, roll: 10 }] },
  { name: "cube", sideData: [{ side_data_type: "Spherical Mapping", projection: "cubemap", padding: 0, yaw: 0, pitch: 0, roll: 0 }] }
];

for (const { name, sideData } of cases) {
  const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/projection-${name}.mkv`, import.meta.url));
  const args = ["-v", "error", "-show_streams", "-of", "json"];

  it(`reports original ${name} projection synchronously`, () => {
    const output = evalSyncFfprobe(bytes, [...args, "input.mkv"], () => bytes);
    expect(output).toBeDefined();
    const stream = JSON.parse(output!).streams[0];
    expect(stream).toMatchObject({ width: 64, height: 32 });
    expect(stream.side_data_list).toEqual(sideData);
  });

  it.each(["input.mkv", "-"])(`reports original ${name} projection from %s`, async target => {
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
    expect(streams[0]).toMatchObject({ width: 64, height: 32 });
    expect(streams[0].side_data_list).toEqual(sideData);
  });
}
