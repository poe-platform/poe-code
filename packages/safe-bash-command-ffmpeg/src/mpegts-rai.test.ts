import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/mpegts-rai.mp4", import.meta.url));

// Native FFmpeg 7.0.2 marks only frames 0, 5 and 10 in this 15-frame fixture.
function inspectTs(bytes: Buffer) {
  const random: number[] = [], pcr: number[] = [], payloads: Buffer[] = [];
  let frame = -1;
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet[0], 0x47);
    const pid = ((packet[1]! & 31) << 8) | packet[2]!;
    if (pid !== 0x100) continue;
    const start = !!(packet[1]! & 64), adaptation = (packet[3]! >> 4) & 3;
    if (start) frame++;
    const flags = adaptation & 2 && packet[4] ? packet[5]! : 0;
    if (flags & 64) {
      assert.ok(start, "RAI belongs only on the first packet of an access unit");
      random.push(frame);
    }
    if (flags & 16) pcr.push(frame);
    if (!(adaptation & 1)) continue;
    let k = 4 + (adaptation & 2 ? 1 + packet[4]! : 0);
    if (start) k += 9 + packet[k + 8]!;
    payloads.push(packet.subarray(k));
  }
  return { random, pcr, frames: frame + 1, hash: createHash("sha256").update(Buffer.concat(payloads)).digest("hex") };
}

for (const [flags, omit] of [
  [[], false], [["+omit_rai"], true], [["-omit_rai"], false], [["omit_rai"], true],
  [["64"], true], [["+omit_rai", "-omit_rai"], false], [["omit_rai-omit_rai"], false],
  [["+latm+omit_rai"], true], [["72"], true], [["+omit_rai", "0"], false]
] as const) {
  for (const sync of [false, true]) {
    it(`signals and frames MPEG-TS random access for flags ${flags.join(",") || "default"} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.mp4": input });
      let stderr = "";
      const args = ["-v", "error", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:v:0"]), "-c:v", "copy",
          ...flags.flatMap(flag => ["-mpegts_flags", flag]), "/out.ts"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        const result = await createFfmpegCommand().execute({
          args,
          cwd: "/", env: {}, signal: new AbortController().signal,
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
      const actual = inspectTs(volume.readFileSync("/out.ts") as Buffer);
      assert.deepEqual(actual.random, omit ? [] : [0, 5, 10]);
      assert.deepEqual(actual.pcr, [0, 5, 10]);
      assert.equal(actual.frames, 15);
      assert.equal(actual.hash, "0a6867e3f00e577fcff36b05c0c5218fdf45fda04d18df97278ac5a75874c4e0");
    });
  }
}
