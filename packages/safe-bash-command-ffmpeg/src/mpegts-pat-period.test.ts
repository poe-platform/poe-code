import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseMpegTs, serializeMpegTs } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// One second of 20 fps H.264. FFmpeg 7.0.2 emits PAT/PMT before frames
// 0,2,...,18 by default; 0,...,19 at 0.05 seconds; and 0,10 at 0.5 seconds.
const input = readFileSync(new URL("./fixtures/mpegts-pat-period.mp4", import.meta.url));

function inspect(bytes: Uint8Array) {
  const tables = new Map<number, { before: number; cc: number; section: number[] }[]>([[0, []], [4096, []]]);
  let frames = 0;
  let videoPid = -1;
  assert.equal(bytes.length % 188, 0);
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet[0], 0x47);
    const pid = ((packet[1]! & 31) << 8) | packet[2]!;
    const adaptation = (packet[3]! >> 4) & 3;
    if (!(adaptation & 1) || !(packet[1]! & 64)) continue;
    let pos = 4 + (adaptation & 2 ? 1 + packet[4]! : 0);
    if (pid === videoPid) {
      assert.deepEqual([...packet.subarray(pos, pos + 4)], [0, 0, 1, 224]);
      frames++;
    }
    if (!tables.has(pid)) continue;
    pos += 1 + packet[pos]!;
    const length = 3 + (((packet[pos + 1]! & 15) << 8) | packet[pos + 2]!);
    const section = [...packet.subarray(pos, pos + length)];
    let crc = 0xffffffff;
    for (const byte of section) {
      crc ^= byte << 24;
      for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
    }
    assert.equal(crc >>> 0, 0, "valid table CRC");
    tables.get(pid)!.push({ before: frames, cc: packet[3]! & 15, section });
    if (pid === 4096) {
      const stream = 12 + (((section[10]! & 15) << 8) | section[11]!);
      videoPid = ((section[stream + 1]! & 31) << 8) | section[stream + 2]!;
    }
  }
  return { frames, tables };
}

function check(bytes: Uint8Array, step: number) {
  const { frames, tables } = inspect(bytes);
  assert.equal(frames, 20);
  for (const rows of tables.values()) {
    assert.deepEqual(rows.map(row => row.before), Array.from({ length: Math.ceil(20 / step) }, (_, i) => i * step));
    assert.deepEqual(rows.map(row => row.cc), rows.map((_, i) => i % 16));
    for (const row of rows) assert.deepEqual(row.section, rows[0]!.section);
  }
  const source = parseMp4(input, { decodeFrames: false });
  const output = parseMpegTs(bytes, { decodeFrames: false });
  assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.pts), source.tracks[0]!.samples.map(sample => sample.pts * 90000 / source.tracks[0]!.timescale));
}

for (const sync of [false, true]) {
  for (const [value, step] of [[undefined, 2], ["0.05", 1], ["0.5", 10], ["50ms", 1], ["00:00:00.5", 10]] as const) {
    it(`repeats MPEG-TS PAT/PMT at ${value ?? "default"} (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/input.mp4": input });
      await run(volume, ["-y", "-i", "/input.mp4", ...(sync ? [] : ["-map", "0:v:0"]), "-c", "copy", ...(value === undefined ? [] : ["-pat_period", value]), "/out.ts"], sync, true);
      check(volume.readFileSync("/out.ts") as Buffer, step);
    });
  }
  for (const value of ["-1", "NaN", "Infinity", "invalid", ""]) {
    it(`rejects PAT period ${value} without overwriting output (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/input.mp4": input, "/out.ts": "KEEP" });
      await run(volume, ["-y", "-i", "/input.mp4", "-c", "copy", "-pat_period", value, "/out.ts"], sync, false);
      assert.equal(volume.readFileSync("/out.ts", "utf8"), "KEEP");
    });
  }
}

it("supports periodic PAT/PMT through the serializer SDK", () => {
  const doc = parseMp4(input, { decodeFrames: false });
  check(serializeMpegTs(doc), 2);
  check(serializeMpegTs(doc, { patPeriod: 0.05 }), 1);
  check(serializeMpegTs(doc, { patPeriod: 0.5 }), 10);
  for (const patPeriod of [-1, NaN, Infinity]) assert.throws(() => serializeMpegTs(doc, { patPeriod }), /pat_period/);
});

it("uses decode time and preserves media packets when repeating tables", () => {
  const source = parseMp4(input, { decodeFrames: false });
  const doc = { ...source, tracks: source.tracks.map(track => ({ ...track,
    samples: track.samples.map((sample, index) => ({ ...sample,
      dts: sample.dts + track.timescale,
      pts: sample.pts + track.timescale * (index % 2 ? 2 : 1)
    }))
  })) };
  const bytes = serializeMpegTs(doc);
  assert.deepEqual(inspect(bytes).tables.get(0)!.map(row => row.before), [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  const mediaPackets = (data: Uint8Array) => {
    const packets: Uint8Array[] = [];
    for (let offset = 0; offset < data.length; offset += 188) {
      const pid = ((data[offset + 1]! & 31) << 8) | data[offset + 2]!;
      if (pid === 256) packets.push(data.subarray(offset, offset + 188));
    }
    return packets;
  };
  assert.deepEqual(mediaPackets(bytes), mediaPackets(serializeMpegTs(doc, { patPeriod: 2 })));
  const everyPacket = serializeMpegTs(doc, { patPeriod: 0 });
  const { tables } = inspect(everyPacket);
  for (const rows of tables.values()) {
    assert.equal(rows.length, mediaPackets(everyPacket).length);
    assert.deepEqual(rows.map(row => row.cc), rows.map((_, i) => i % 16));
  }
});

async function run(volume: InstanceType<typeof Volume>, args: string[], sync: boolean, success: boolean) {
  if (sync) {
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), success ? "" : undefined);
    return;
  }
  let stderr = "";
  const result = await Promise.resolve(createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never)).catch((error: unknown) => {
    assert.equal(success, false);
    assert.match(String(error), /pat_period/);
    return { exitCode: 1 };
  });
  assert.equal(result.exitCode === 0, success, stderr);
}
