import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const fixture = Buffer.from("UklGRlwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAATElTVCYAAABJTkZPSU5BTQoAAABPbGQgdGl0bGUASUFSVAcAAABQbGF5ZXIAAGRhdGEKAAAAAIAA/wAAAAEAfw==", "base64");

function chunks(bytes: Buffer, start: number, end: number): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  for (let offset = start; offset + 8 <= end;) {
    const size = bytes.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + size <= end);
    result.set(bytes.toString("ascii", offset, offset + 4), bytes.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + size % 2;
  }
  return result;
}

for (const scenario of [
  { name: "copy", args: ["-c:a", "copy"], tags: { INAM: "Old title", IART: "Player" } },
  { name: "update", args: ["-metadata", "title=New title", "-metadata", "comment=My note"], tags: { INAM: "New title", IART: "Player", ICMT: "My note" } },
  { name: "unicode", args: ["-metadata", "title=Été 🎵"], tags: { INAM: "Été 🎵", IART: "Player" } },
  { name: "remove", args: ["-map_metadata", "-1"], tags: {} },
  { name: "delete title", args: ["-metadata", "title="], tags: { IART: "Player" } },
  { name: "BWF remove", args: ["-map_metadata", "-1"], tags: {} },
  { name: "BWF", args: ["-c:a", "copy"], tags: { ICMT: "TakeOne", ICRD: "2025-01-02", ITCH: "StudioA" } }
])
for (const sync of [false, true]) {
  it(`preserves WAV INFO metadata: ${scenario.name} (${sync ? "sync" : "async"})`, async () => {
    let input = fixture;
    if (scenario.name.startsWith("BWF")) {
      const bext = Buffer.alloc(610);
      bext.write("bext"); bext.writeUInt32LE(602, 4);
      bext.write("TakeOne", 8); bext.write("StudioA", 264); bext.write("2025-01-02", 328);
      input = Buffer.concat([fixture.subarray(0, 36), bext, fixture.subarray(82)]);
      input.writeUInt32LE(input.length - 8, 4);
    }
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    const args = ["-v", "error", "-y", "-i", "/in.wav", ...scenario.args, "/out.wav"];
    if (sync) {
      const result = evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      assert.equal(result, "");
    } else {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    const output = volume.readFileSync("/out.wav") as Buffer;
    assert.equal(output.readUInt32LE(4), output.length - 8);
    const top = chunks(output, 12, output.length);
    const list = top.get("LIST");
    const tags: Record<string, string> = {};
    if (list) {
      assert.equal(list.toString("ascii", 0, 4), "INFO");
      for (const [key, value] of chunks(list, 4, list.length)) {
        if (key !== "ISFT") tags[key] = value.toString("utf8").split("\0")[0]!;
      }
    }
    assert.deepEqual(tags, scenario.tags);
    assert.deepEqual(top.get("data"), fixture.subarray(90));
    assert.equal(top.has("bext"), false);
  });
}
