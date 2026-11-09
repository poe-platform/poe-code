import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { auAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const [headerOffset, annotation] of [
  [32, Buffer.alloc(8)],
  [undefined, Buffer.from("Title=Evening\nArtist=Kay\nComment=note\ncustom=solo\n\0")],
  [0x80000000, Buffer.alloc(0)], [0xfffffffe, Buffer.alloc(0)], [0xffffffff, Buffer.alloc(0)]
] as const) {
  it(`reports AU packet positions from the file start for header offset ${headerOffset ?? 24 + annotation.length}`, async () => {
    const offset = 24 + annotation.length;
    const bytes = Buffer.alloc(offset + 8);
    [0x2e736e64, headerOffset ?? offset, 8, 3, 8000, 1].forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
    annotation.copy(bytes, 24);
    Buffer.from("000101fffc1903e8", "hex").copy(bytes, offset);
    const expected = { packets: [{ pos: String(offset), size: "8", duration: 4 }], streams: [{ duration_ts: 4 }] };
    expect(auAst().probe(bytes, { showPackets: true })).toMatchObject(expected);
    const args = ["-v", "error", "-show_packets", "-show_entries", "packet=pos,size,duration:stream=duration_ts", "-of", "json", "/in.au"];
    expect(JSON.parse(evalSyncFfprobe(bytes, [...args.slice(0, -1), "pipe:0"])!)).toMatchObject(expected);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.au", bytes);
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

it("keeps successive AU packet positions relative to a sliced input file", () => {
  const bytes = Buffer.alloc(16 + 32 + 1032).subarray(16);
  [0x2e736e64, 32, 1032, 3, 8000, 1].forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
  expect(auAst().probe(bytes, { showPackets: true }).packets).toMatchObject([
    { pos: "32", size: "640", duration: 320 },
    { pos: "672", size: "392", duration: 196 }
  ]);
});
