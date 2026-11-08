import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const bits of [24, 32]) {
  for (const [format, hex] of [
    ["s16le", bits === 24 ? "fffeffff00000000ff00" : "feffffff000000000000"],
    ["s8", bits === 24 ? "feff000000" : "ffff000000"],
    ["u8", bits === 24 ? "7e7f808080" : "7f7f808080"]
  ] as const) {
    for (const sync of [false, true]) {
      it(`narrows raw PCM${bits} to ${format} (${sync ? "sync" : "async"})`, async () => {
        const input = Buffer.alloc(5 * bits / 8);
        [-65537, -1, 0, 255, 65535].forEach((value, i) => input.writeIntLE(value, i * bits / 8, bits / 8));
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.raw", input);
        const args = ["-v", "error", "-y", "-f", `s${bits}le`, "-ar", "8000", "-ac", "1", "-i", "/in.raw", "-f", format, "/out.raw"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
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
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(hex, "hex"));
      });
    }
  }
}
