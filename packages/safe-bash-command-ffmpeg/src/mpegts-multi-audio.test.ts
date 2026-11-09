import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4, serializeMpegTs } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Two synthetic tones (400/800 Hz); native FFmpeg 7.0.2 single-track ADTS controls.
const input = readFileSync(new URL("./fixtures/mpegts-multi-audio.m4a", import.meta.url));
const hashes = [
  "faba019398613b538e7fa3e70b59eecd2d2319157a51deccf91fe4df294519c8",
  "deab7d72ffe8773bcbe4f4941c08986ec452b2a3f2d1c23ac1cb8332cbe7c9d7"
];

function inspectTs(bytes: Buffer) {
  let pmtPid = -1;
  const streams = new Map<number, Buffer[]>();
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet[0], 0x47);
    const pid = packet.readUInt16BE(1) & 8191;
    const start = !!(packet[1]! & 64), adaptation = (packet[3]! >> 4) & 3;
    if (!(adaptation & 1)) continue;
    let k = 4 + (adaptation & 2 ? 1 + packet[4]! : 0);
    if (start && (pid === 0 || pid === pmtPid)) {
      k += 1 + packet[k]!;
      const section = packet.subarray(k);
      if (pid === 0) pmtPid = section.readUInt16BE(10) & 8191;
      else {
        const pids = new Set<number>();
        const end = 3 + (section.readUInt16BE(1) & 4095) - 4;
        for (let entry = 12 + (section.readUInt16BE(10) & 4095); entry < end;
          entry += 5 + (section.readUInt16BE(entry + 3) & 4095)) {
          assert.equal(section[entry], 15);
          const audioPid = section.readUInt16BE(entry + 1) & 8191;
          assert.equal(pids.has(audioPid), false, "distinct PMT PIDs");
          pids.add(audioPid);
          if (!streams.has(audioPid)) streams.set(audioPid, []);
        }
      }
      continue;
    }
    if (!streams.has(pid)) continue;
    if (start) {
      assert.equal(packet.readUIntBE(k, 3), 1, "PES start code");
      k += 9 + packet[k + 8]!;
    }
    streams.get(pid)!.push(packet.subarray(k));
  }
  return [...streams.values()].map(parts => {
    const payload = Buffer.concat(parts);
    let frames = 0;
    for (let k = 0; k < payload.length;) {
      assert.equal(payload[k], 255, "ADTS sync");
      const length = ((payload[k + 3]! & 3) << 11) | (payload[k + 4]! << 3) | (payload[k + 5]! >> 5);
      assert.ok(length >= 7 && length <= payload.length - k);
      k += length;
      frames++;
    }
    assert.equal(frames, 20);
    return createHash("sha256").update(payload).digest("hex");
  });
}

async function run(maps: string[]) {
  const volume = Volume.fromJSON({ "/in.m4a": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.m4a", ...maps.flatMap(map => ["-map", map]), "-c:a", "copy", "/out.ts"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}

for (const [name, maps, expected] of [
  ["first control", ["0:a:0"], [hashes[0]]],
  ["second control", ["0:a:1"], [hashes[1]]],
  ["all audio", ["0:a"], hashes],
  ["reversed maps", ["0:a:1", "0:a:0"], [hashes[1], hashes[0]]],
  ["repeated map", ["0:a:0", "0:a:0"], [hashes[0], hashes[0]]]
] as const) {
  it(`retains MPEG-TS AAC payloads in map order: ${name}`, async () => {
    const { result, volume, stderr } = await run([...maps]);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(inspectTs(volume.readFileSync("/out.ts") as Buffer), expected);
  });

  it(`retains MPEG-TS AAC payloads through the serializer API: ${name}`, () => {
    const doc = parseMp4(input);
    const tracks = maps.flatMap(map => map === "0:a" ? doc.tracks : [doc.tracks[Number(map.split(":")[2])]!]);
    assert.deepEqual(inspectTs(Buffer.from(serializeMpegTs({ ...doc, tracks }))), expected);
  });
}
