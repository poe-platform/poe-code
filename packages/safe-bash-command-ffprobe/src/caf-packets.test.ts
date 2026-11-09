import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { cafAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const info of [Buffer.alloc(0), Buffer.from("696e666f000000000000000400000000", "hex")]) {
  it(`reports CAF packet boundaries with ${info.length} metadata bytes`, async () => {
    const header = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d0000000000000002000000010000000100000010", "hex");
    const dataHeader = Buffer.from("646174610000000000002ee400000000", "hex");
    const bytes = Buffer.concat([header, info, dataHeader, Buffer.alloc(12000)]);
    const expected = { packets: [
      { pos: String(68 + info.length), size: "4096", duration: 2048 },
      { pos: String(4164 + info.length), size: "4096", duration: 2048 },
      { pos: String(8260 + info.length), size: "3808", duration: 1904 }
    ], streams: [{ duration_ts: 6000 }] };
    expect(cafAst().probe(bytes, { showPackets: true })).toMatchObject(expected);
    const args = ["-v", "error", "-show_packets", "-show_entries", "packet=pos,size,duration:stream=duration_ts", "-of", "json", "/in.caf"];
    expect(JSON.parse(evalSyncFfprobe(undefined, args, () => bytes)!)).toMatchObject(expected);
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
    expect(JSON.parse(output)).toMatchObject(expected);
  });
}
