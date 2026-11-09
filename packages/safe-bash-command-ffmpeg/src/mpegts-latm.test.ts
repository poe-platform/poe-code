import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/mpegts-latm.m4a", import.meta.url));

// Native FFmpeg 7.0.2 elementary payloads from the same input, with and without +latm.
function inspectTs(bytes: Buffer) {
  let pmtPid = -1, audioPid = -1, streamType = -1;
  const payloads: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet[0], 0x47);
    const pid = ((packet[1]! & 31) << 8) | packet[2]!;
    const start = !!(packet[1]! & 64), adaptation = (packet[3]! >> 4) & 3;
    if (!(adaptation & 1)) continue;
    let k = 4 + (adaptation & 2 ? 1 + packet[4]! : 0);
    if (start && (pid === 0 || pid === pmtPid)) {
      k += 1 + packet[k]!;
      if (pid === 0) pmtPid = ((packet[k + 10]! & 31) << 8) | packet[k + 11]!;
      else {
        const entry = k + 12 + (((packet[k + 10]! & 15) << 8) | packet[k + 11]!);
        streamType = packet[entry]!;
        audioPid = ((packet[entry + 1]! & 31) << 8) | packet[entry + 2]!;
      }
      continue;
    }
    if (pid !== audioPid) continue;
    if (start) k += 9 + packet[k + 8]!;
    payloads.push(packet.subarray(k));
  }
  return { streamType, hash: createHash("sha256").update(Buffer.concat(payloads)).digest("hex") };
}

for (const [flags, latm] of [
  [[], false], [["+latm"], true], [["-latm"], false], [["latm"], true],
  [["8"], true], [["+latm", "-latm"], false], [["latm-latm"], false]
] as const) {
  for (const sync of [false, true]) {
    it(`signals and frames MPEG-TS AAC for flags ${flags.join(",") || "default"} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.m4a": input });
      let stderr = "";
      const args = ["-v", "error", "-i", "/in.m4a", ...(sync ? [] : ["-map", "0:a:0"]), "-c:a", "copy",
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
      assert.deepEqual(inspectTs(volume.readFileSync("/out.ts") as Buffer), {
        streamType: latm ? 0x11 : 0x0f,
        hash: latm ? "81581d4946d406d0adcf18c66b1f12705112a4d3e6d7269a84e41c651dbda469"
          : "f154dc43bc3cceda63152afb919d8df886799086eafa52a58b65166b1ea593a6"
      });
    });
  }
}
