import assert from "node:assert/strict";
import { parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const source = parseMp4(readFileSync(new URL("./fixtures/mpegts-latm.m4a", import.meta.url)));
const audio = source.tracks[0]!;
const input = serializeMp4({ ...source, tracks: [
  { ...audio, id: 1, language: "eng" },
  { ...audio, id: 2, language: "fra", samples: audio.samples.slice(0, 2) }
] });

// Inspect the PMT independently and compare elementary payloads across metadata changes.
function inspectTs(bytes: Buffer) {
  let pmtPid = -1, audioPid = -1, streamType = -1;
  const payloads: Buffer[] = [];
  let descriptors: Buffer = Buffer.alloc(0);
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
        const length = ((packet[entry + 3]! & 15) << 8) | packet[entry + 4]!;
        descriptors = packet.subarray(entry + 5, entry + 5 + length);
        audioPid = ((packet[entry + 1]! & 31) << 8) | packet[entry + 2]!;
      }
      continue;
    }
    if (pid !== audioPid) continue;
    if (start) k += 9 + packet[k + 8]!;
    payloads.push(packet.subarray(k));
  }
  return { streamType, descriptors, payload: Buffer.concat(payloads) };
}

for (const sync of [false, true]) {
  for (const selected of [0, 1]) {
    it(`preserves selected AAC language and overrides (${sync ? "sync" : "async"}, track ${selected})`, async () => {
      let originalPayload: Buffer | undefined;
      for (const language of [undefined, "deu", ""]) {
        const volume = Volume.fromJSON({ "/in.m4a": Buffer.from(sync ? serializeMp4({ ...source, tracks: [parseMp4(input).tracks[selected]!] }) : input) });
        let stderr = "";
        const args = ["-i", "/in.m4a", ...(sync ? [] : ["-map", `0:a:${selected}`]), "-c:a", "copy",
          ...(language === undefined ? [] : ["-metadata:s:a:0", `language=${language}`]), "/out.ts"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
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
        const actual = inspectTs(volume.readFileSync("/out.ts") as Buffer);
        const expected = language ?? (selected === 0 ? "eng" : "fra");
        assert.equal(actual.streamType, 0x0f);
        assert.deepEqual(actual.descriptors, expected ? Buffer.from([0x0a, 4, ...Buffer.from(expected), 0]) : Buffer.alloc(0));
        if (originalPayload) assert.deepEqual(actual.payload, originalPayload);
        else originalPayload = actual.payload;
      }
    });
  }
}
