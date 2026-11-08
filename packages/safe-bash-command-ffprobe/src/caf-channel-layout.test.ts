import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { cafAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const [channels, tag, layout] of [
  [4, 0x006c0004, "quad"], [1, undefined, undefined],
  [4, undefined, undefined], [1, 0x00640001, "mono"],
  [2, 0x00650002, "stereo"], [4, 0xffff0004, undefined]
] as const) {
  it(`reports CAF layout ${layout} for ${channels} channels and tag ${tag}`, async () => {
    const header = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d0000000000000002000000010000000100000010", "hex");
    header.writeUInt32BE(2 * channels, 36);
    header.writeUInt32BE(channels, 44);
    const chan = tag === undefined ? Buffer.alloc(0) : Buffer.from("6368616e000000000000000c000000000000000000000000", "hex");
    if (tag !== undefined) chan.writeUInt32BE(tag, 12);
    const data = Buffer.from("64617461000000000000000c000000000064ff38012cfe70", "hex");
    const bytes = Buffer.concat([header, chan, data]);
    const ast = cafAst();
    expect(ast.probe(bytes).streams[0]?.channel_layout).toBe(layout);
    expect(ast.parse(bytes).tracks[0]?.decodedAudio?.channelData.map(samples => samples[0]))
      .toEqual([100, -200, 300, -400].slice(0, channels).map(sample => sample / 32768));
    const args = ["-v", "error", "-show_entries", "stream=channels,channel_layout", "-of", "json", "/in.caf"];
    const expected = [{ channels, ...(layout ? { channel_layout: layout } : {}) }];
    expect(JSON.parse(evalSyncFfprobe(bytes, [...args.slice(0, -1), "pipe:0"])!).streams).toEqual(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.caf", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output).streams).toEqual(expected);
  });
}
