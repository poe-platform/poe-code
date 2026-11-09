import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { auAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const size of [4, 16, 0, 9, 0xffffffff]) {
  it(`reports AU header duration independently of packets (size=${size})`, async () => {
    const bytes = Buffer.from("2e736e6400000020000000080000000300001f400000000100000000000000000064ff38012cfe70" + (size === 9 ? "58" : ""), "hex");
    bytes.writeUInt32BE(size, 8);
    const duration = size === 0xffffffff ? 4 : Math.floor(size / 2);
    const probe = auAst().probe(bytes, { showPackets: true });
    expect(probe.streams[0]!.duration_ts).toBe(duration);
    expect(probe.packets!.map(({ size, duration }) => ({ size, duration }))).toEqual([
      { size: String(bytes.length - 32), duration: 4 }
    ]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.au", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(["-v", "error", "-show_packets", "-show_entries",
        "packet=size,duration:stream=duration_ts", "-of", "json", "/in.au"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(evalSyncFfprobe(bytes, ["-show_packets", "-show_entries",
      "packet=size,duration:stream=duration_ts", "-of", "json", "pipe:0"])!)).toEqual({
        ...JSON.parse(output), streams: size === 0xffffffff ? [{}] : [{ duration_ts: duration }]
      });
    expect(JSON.parse(output)).toMatchObject({
      packets: [{ size: String(bytes.length - 32), duration: 4 }],
      streams: [{ duration_ts: duration }]
    });
  });
}
