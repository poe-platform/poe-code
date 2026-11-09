import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { aiffAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe: -v error -show_entries packet=pos,size,pts,duration -of json.
const fixtures = [
  ["plain", "464f524d0000003841494646434f4d4d000000120001000000050010400bfa0000000000000053534e44000000120000000000000000000bff2b0bb80001fff7", 54],
  ["offset", "464f524d0000004041494646434f4d4d000000120001000000050010400bfa0000000000000053534e4400000019000000070000001000010203040506000bff2b0bb80001fff700", 61],
  ["late COMM", "464f524d000000404149464653534e4400000019000000070000001000010203040506000bff2b0bb80001fff700434f4d4d000000120001000000050010400bfa00000000000000", 35]
] as const;

for (const [name, hex, pos] of fixtures) {
  it(`reports physical AIFF packet positions with ${name}`, async () => {
    const bytes = Buffer.from(hex, "hex");
    const expected = { packets: [{ pos: String(pos), size: "10", pts: 0, duration: 5 }] };
    expect(aiffAst().probe(bytes, { showPackets: true })).toMatchObject(expected);
    for (const decodeAudio of [true, false]) {
      expect(aiffAst().parse(bytes, { decodeAudio }).tracks[0]!.samples).toMatchObject([
        { offset: pos, size: 10, pts: 0, dts: 0, duration: 5 }
      ]);
    }
    const args = ["-v", "error", "-show_entries", "packet=pos,size,pts,duration", "-of", "json", "/in.aiff"];
    expect(JSON.parse(evalSyncFfprobe(bytes, [...args.slice(0, -1), "pipe:0"])!)).toEqual(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.aiff", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(diagnostic).toBe("");
    expect(JSON.parse(output)).toEqual(expected);
  });
}

it("keeps successive AIFF packet positions relative to a sliced input file", () => {
  const bytes = Buffer.alloc(16 + 54 + 1032).subarray(16);
  Buffer.from(fixtures[0][1], "hex").copy(bytes, 0, 0, 54);
  bytes.writeUInt32BE(bytes.length - 8, 4);
  bytes.writeUInt32BE(516, 22);
  bytes.writeUInt32BE(1040, 42);
  expect(aiffAst().probe(bytes, { showPackets: true }).packets).toMatchObject([
    { pos: "54", size: "1024", pts: 0, duration: 512 },
    { pos: "1078", size: "8", pts: 512, duration: 4 }
  ]);
});
