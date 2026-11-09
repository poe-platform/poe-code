import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { annexBToAvcc, createSyntheticMp4, parseMp4, serializeMpegTs } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/mpegts-angles.mp4", import.meta.url));
// FFmpeg 7.0.2: -i input.mp4 -map 0:v -c:v copy out.ts (two 64x48 angles, six frames each).
const native = inspect(readFileSync(new URL("./fixtures/mpegts-angles-native.ts.bin", import.meta.url)));

function inspect(bytes: Uint8Array) {
  const streams = new Map<number, { type: number; samples: Uint8Array[][] }>();
  const pcrPids = new Set<number>();
  let pcrPid = -1;
  let programMaps = 0;
  const decodeTimes: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet[0], 0x47);
    const pid = ((packet[1]! & 31) << 8) | packet[2]!;
    const start = (packet[1]! & 64) !== 0;
    const adaptation = (packet[3]! >> 4) & 3;
    if ((adaptation & 2) && packet[4]! >= 7 && (packet[5]! & 16)) pcrPids.add(pid);
    if (!(adaptation & 1)) continue;
    let pos = 4 + ((adaptation & 2) ? 1 + packet[4]! : 0);
    if (pid === 4096 && start) {
      programMaps++;
      pos += 1 + packet[pos]!;
      const section = packet.subarray(pos);
      pcrPid = ((section[8]! & 31) << 8) | section[9]!;
      const end = 3 + (((section[1]! & 15) << 8) | section[2]!) - 4;
      for (let i = 12 + (((section[10]! & 15) << 8) | section[11]!); i < end;) {
        const streamPid = ((section[i + 1]! & 31) << 8) | section[i + 2]!;
        if (!streams.has(streamPid)) streams.set(streamPid, { type: section[i]!, samples: [] });
        i += 5 + (((section[i + 3]! & 15) << 8) | section[i + 4]!);
      }
    } else if (streams.has(pid)) {
      const stream = streams.get(pid)!;
      if (start) {
        assert.deepEqual([...packet.subarray(pos, pos + 3)], [0, 0, 1]);
        const timestamp = pos + ((packet[pos + 7]! & 64) ? 14 : 9);
        decodeTimes.push((packet[timestamp]! & 14) * 2 ** 29 + packet[timestamp + 1]! * 2 ** 22
          + (packet[timestamp + 2]! & 254) * 2 ** 14 + packet[timestamp + 3]! * 128
          + (packet[timestamp + 4]! >>> 1));
        pos += 9 + packet[pos + 8]!;
        stream.samples.push([]);
      }
      stream.samples.at(-1)!.push(packet.subarray(pos));
    }
  }
  return { pcrPid, pcrPids, programMaps, decodeTimes, streams: [...streams].map(([pid, stream]) => ({
    pid, type: stream.type, samples: stream.samples.map(parts => annexBToAvcc(Buffer.concat(parts)))
  })) };
}

const cases = [
  { maps: ["0:v"], angles: [0, 1] },
  { maps: ["0:v:1", "0:v:0"], angles: [1, 0] },
  { maps: ["0:v:0"], angles: [0] },
  { maps: ["0:v:1"], angles: [1] }
];

function check(bytes: Uint8Array, angles: number[], startPid = 256) {
  const actual = inspect(bytes);
  assert.deepEqual(actual.streams.map(({ pid, type }) => ({ pid, type })),
    angles.map((_, i) => ({ pid: startPid + i, type: 27 })));
  assert.deepEqual(actual.decodeTimes, [...actual.decodeTimes].sort((a, b) => a - b));
  assert.equal(actual.pcrPid, startPid);
  assert.deepEqual([...actual.pcrPids], [startPid]);
  for (const [index, angle] of angles.entries()) {
    assert.equal(actual.streams[index]!.samples.length, 6);
    assert.deepEqual(actual.streams[index]!.samples, native.streams[angle]!.samples);
  }
}

for (const { maps, angles } of cases) {
  it(`copies distinct H.264 angles in requested order: ${maps.join(", ")}`, async () => {
    const volume = Volume.fromJSON({ "/input.mp4": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/input.mp4", ...maps.flatMap(map => ["-map", map]), "-c:v", "copy", "/out.ts"],
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
    check(volume.readFileSync("/out.ts") as Buffer, angles);
  });

  it(`serializes distinct SDK H.264 angles in order: ${angles.join(", ")}`, () => {
    const doc = parseMp4(input);
    const tracks = angles.map(angle => doc.tracks[angle]!);
    for (const startPid of [256, 384]) {
      check(serializeMpegTs({ ...doc, tracks }, { mpegtsStartPid: startPid }), angles, startPid);
    }
  });
}


it("keeps both video payloads and the first video clock when audio is mapped first", () => {
  const doc = parseMp4(input);
  const audio = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1, includeAudio: true }))
    .tracks.find(track => track.type === "audio")!;
  const actual = inspect(serializeMpegTs({ ...doc, tracks: [audio, ...doc.tracks] }));
  assert.deepEqual(actual.streams.map(({ pid, type }) => ({ pid, type })),
    [{ pid: 256, type: 15 }, { pid: 257, type: 27 }, { pid: 258, type: 27 }]);
  assert.equal(actual.pcrPid, 257);
  assert.deepEqual([...actual.pcrPids], [257]);
  assert.deepEqual(actual.streams.slice(1).map(stream => stream.samples), native.streams.map(stream => stream.samples));
});

it("repeats program tables at frames from either video track", () => {
  const actual = inspect(serializeMpegTs(parseMp4(input), { patPmtAtFrames: true, patPeriod: 1000 }));
  assert.equal(actual.programMaps, 12);
});

it("rejects mapped video tracks that would use the null PID or overflow the PMT", () => {
  const doc = parseMp4(input);
  assert.throws(() => serializeMpegTs({ ...doc, tracks: Array(6).fill(doc.tracks[0]!) },
    { mpegtsStartPid: 8186 }), /PID/);
  assert.throws(() => serializeMpegTs({ ...doc, tracks: Array(202).fill(doc.tracks[0]!) }), /program map/);
});
