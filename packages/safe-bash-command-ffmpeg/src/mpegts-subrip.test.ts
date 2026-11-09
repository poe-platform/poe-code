import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, serializeMpegTs } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/mpegts-subrip.mkv", import.meta.url));
// FFmpeg 7.0.2: -i input.mkv -map 0:v -map 0:s -c copy out.ts
const native = readFileSync(new URL("./fixtures/mpegts-subrip-native.ts.bin", import.meta.url));

function inspect(bytes: Uint8Array) {
  const streams = new Map<number, { type: number; packets: { pts: number; parts: Uint8Array[] }[] }>();
  let pmtPid = -1;
  assert.equal(bytes.length % 188, 0);
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet[0], 0x47);
    const pid = ((packet[1]! & 31) << 8) | packet[2]!;
    const start = (packet[1]! & 64) !== 0;
    const adaptation = (packet[3]! >> 4) & 3;
    if (!(adaptation & 1)) continue;
    let pos = 4 + ((adaptation & 2) ? 1 + packet[4]! : 0);
    if (start && (pid === 0 || pid === pmtPid)) {
      pos += 1 + packet[pos]!;
      const section = packet.subarray(pos);
      if (pid === 0) pmtPid = ((section[10]! & 31) << 8) | section[11]!;
      else {
        const end = 3 + (((section[1]! & 15) << 8) | section[2]!) - 4;
        for (let i = 12 + (((section[10]! & 15) << 8) | section[11]!); i < end;) {
          const streamPid = ((section[i + 1]! & 31) << 8) | section[i + 2]!;
          if (!streams.has(streamPid)) streams.set(streamPid, { type: section[i]!, packets: [] });
          i += 5 + (((section[i + 3]! & 15) << 8) | section[i + 4]!);
        }
      }
      continue;
    }
    const stream = streams.get(pid);
    if (!stream) continue;
    if (start) {
      assert.deepEqual(Array.from(packet.subarray(pos, pos + 3)), [0, 0, 1]);
      if (stream.type === 6) assert.equal(packet[pos + 3], 0xbd);
      const k = pos + 9;
      const pts = (packet[k]! & 14) * 536870912 + packet[k + 1]! * 4194304
        + (packet[k + 2]! & 254) * 16384 + packet[k + 3]! * 128 + (packet[k + 4]! >> 1);
      stream.packets.push({ pts, parts: [] });
      pos += 9 + packet[pos + 8]!;
    }
    stream.packets.at(-1)!.parts.push(packet.subarray(pos));
  }
  return [...streams].map(([pid, stream]) => ({ pid, type: stream.type, count: stream.packets.length,
    cues: stream.type === 6 ? stream.packets.map(packet => ({ pts: packet.pts, text: Buffer.concat(packet.parts).toString() })) : [] }));
}

const expected = [
  { pid: 256, type: 27, count: 10, cues: [] },
  { pid: 257, type: 6, count: 2, cues: [
    { pts: 144000, text: "First speaker" },
    { pts: 180000, text: "Second speaker" }
  ] }
];
it("independently reads the native private SubRip stream and cue timestamps", () => {
  assert.deepEqual(inspect(native), expected);
});

for (const [maps, extension] of [
  [["0:v", "0:s"], "ts"], [["0"], "ts"], [["0:v"], "ts"], [["0:s", "0:v"], "ts"], [["0:s"], "srt"]
] as const) {
  it(`preserves MPEG-TS mapped streams and SubRip payloads for ${maps.join(", ")} to ${extension}`, async () => {
    const volume = Volume.fromJSON({ "/input.mkv": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/input.mkv", ...maps.flatMap(map => ["-map", map]), "-c", "copy", `/out.${extension}`],
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
    if (extension === "srt") {
      assert.equal(volume.readFileSync("/out.srt", "utf8"),
        "1\n00:00:00,200 --> 00:00:00,400\nFirst speaker\n\n2\n00:00:00,600 --> 00:00:00,800\nSecond speaker\n\n");
      return;
    }
    const selected = maps.length === 1 && maps[0] === "0:v" ? expected.slice(0, 1)
      : maps[0] === "0:s" ? [...expected].reverse().map((stream, i) => ({ ...stream, pid: 256 + i })) : expected;
    assert.deepEqual(inspect(volume.readFileSync("/out.ts") as Buffer), selected);
  });
}

it("copies long UTF-8 SubRip packets through the SDK without changing bytes or timing", () => {
  const doc = parseMkv(input, { decodeFrames: false, decodeAudio: false });
  const subtitle = doc.tracks.find(track => track.type === "subtitle")!;
  const text = "<i>Zażółć gęślą jaźń</i>\n".repeat(30);
  const data = new TextEncoder().encode(text);
  const tracks = [{ ...subtitle, samples: [{ ...subtitle.samples[0]!, data, size: data.length }] }];
  assert.deepEqual(inspect(serializeMpegTs({ ...doc, tracks })), [
    { pid: 256, type: 6, count: 1, cues: [{ pts: 144000, text }] }
  ]);
});
