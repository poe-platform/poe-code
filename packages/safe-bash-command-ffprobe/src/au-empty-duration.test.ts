import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { auAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const [declaredSize, samples, duration] of [[0xffffffff, 0, undefined], [0, 0, 0], [0xffffffff, 4, 4]] as const) {
  it(`probes AU duration with declared size ${declaredSize} and ${samples} samples`, async () => {
    const bytes = Buffer.from("2e736e6400000020000000080000000300001f400000000100000000000000000064ff38012cfe70", "hex").subarray(0, 32 + samples * 2);
    bytes.writeUInt32BE(declaredSize, 8);
    expect(auAst().probe(bytes).streams[0]!.duration_ts).toBe(duration);
    const expected = {
      programs: [], stream_groups: [],
      packets: samples ? [{ size: "8", duration: 4 }] : [],
      streams: [duration === undefined ? {} : { duration_ts: duration }]
    };
    const args = ["-v", "error", "-show_packets", "-show_entries",
      "packet=size,duration:stream=duration_ts", "-of", "json"];
    expect(JSON.parse(evalSyncFfprobe(bytes, [...args, "pipe:0"])!)).toEqual(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.au", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments([...args, "/in.au"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output)).toEqual(expected);
  });
}
