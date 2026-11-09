import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMpegTs } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/mpegts-pid.m4a", import.meta.url));
// FFmpeg 7.0.2: -i input.m4a -map 0:a -c copy [-mpegts_start_pid 384] out.ts
const native = ["mpegts-pid-native.ts.bin", "mpegts-pid-native-384.ts.bin"].map(name =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

function inspect(bytes: Uint8Array) {
  let pmtPid = -1;
  let pcrPid = -1;
  const streams: { type: number; pid: number }[] = [];
  const payloads = new Map<number, Uint8Array[]>();
  const pcrPackets = new Set<number>();
  assert.equal(bytes.length % 188, 0);
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet[0], 0x47);
    const pid = ((packet[1]! & 31) << 8) | packet[2]!;
    const start = (packet[1]! & 64) !== 0;
    const adaptation = (packet[3]! >> 4) & 3;
    if ((adaptation & 2) && packet[4]! >= 7 && (packet[5]! & 16)) pcrPackets.add(pid);
    if (!(adaptation & 1)) continue;
    let pos = 4 + ((adaptation & 2) ? 1 + packet[4]! : 0);
    if (start && (pid === 0 || pid === pmtPid)) {
      pos += 1 + packet[pos]!;
      const section = packet.subarray(pos);
      if (pid === 0) pmtPid = ((section[10]! & 31) << 8) | section[11]!;
      else {
        pcrPid = ((section[8]! & 31) << 8) | section[9]!;
        const end = 3 + (((section[1]! & 15) << 8) | section[2]!) - 4;
        streams.length = 0;
        for (let i = 12 + (((section[10]! & 15) << 8) | section[11]!); i < end;) {
          streams.push({ type: section[i]!, pid: ((section[i + 1]! & 31) << 8) | section[i + 2]! });
          i += 5 + (((section[i + 3]! & 15) << 8) | section[i + 4]!);
        }
      }
    } else if (streams.some(stream => stream.pid === pid)) {
      if (start) {
        assert.deepEqual(Array.from(packet.subarray(pos, pos + 3)), [0, 0, 1]);
        pos += 9 + packet[pos + 8]!;
      }
      const parts = payloads.get(pid) ?? [];
      parts.push(packet.subarray(pos));
      payloads.set(pid, parts);
    }
  }
  return { streams, pcrPid, pcrPackets, payloads };
}

for (const sync of [false, true]) {
  for (const value of [undefined, "384", "0x180", "32", "8186"]) {
    it(`copies audio with matching PMT, PCR and packet PID ${value ?? "default"} (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/input.m4a": input });
      const args = ["-y", "-i", "/input.m4a", ...(sync ? [] : ["-map", "0:a"]), "-c", "copy",
        ...(value === undefined ? [] : ["-mpegts_start_pid", value]), "/out.ts"];
      await run(volume, args, sync, true);
      const actual = inspect(volume.readFileSync("/out.ts") as Buffer);
      const expected = inspect(native[value === undefined ? 0 : 1]!);
      const pid = value === undefined ? 256 : Number(value);
      assert.deepEqual(actual.streams, [{ type: 15, pid }]);
      assert.equal(actual.pcrPid, pid);
      assert.deepEqual([...actual.pcrPackets], [pid]);
      assert.deepEqual([...actual.payloads.keys()], [pid]);
      const audio = Buffer.concat(actual.payloads.get(pid)!);
      assert.equal(audio.length, 6672);
      assert.deepEqual(audio, Buffer.concat(expected.payloads.get(expected.streams[0]!.pid)!));
      if (value === undefined || value === "384") assert.deepEqual(actual.streams, expected.streams);
    });
  }
  for (const value of ["31", "8187", "4096", "invalid", "", "1.5"]) {
    it(`rejects invalid MPEG-TS PID ${value} before overwriting output (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/input.m4a": input, "/out.ts": "KEEP" });
      await run(volume, ["-y", "-i", "/input.m4a", "-c", "copy", "-mpegts_start_pid", value, "/out.ts"], sync, false);
      assert.equal(volume.readFileSync("/out.ts", "utf8"), "KEEP");
    });
  }
}

for (const maps of [["0:v"], ["0:v", "0:a"], ["0:a", "0:v"]]) {
  it(`assigns packet PIDs in command mapping order ${maps.join(",")}`, async () => {
    const input = createSyntheticMp4({ width: 16, height: 16, frameCount: 1, includeAudio: true });
    const volume = Volume.fromJSON({ "/input.mp4": Buffer.from(input) });
    await run(volume, ["-y", "-i", "/input.mp4", ...maps.flatMap(map => ["-map", map]),
      "-c", "copy", "-mpegts_start_pid", "384", "/out.ts"], false, true);
    const actual = inspect(volume.readFileSync("/out.ts") as Buffer);
    assert.deepEqual(actual.streams, maps.map((map, i) => ({ type: map === "0:v" ? 27 : 15, pid: 384 + i })));
    assert.equal(actual.pcrPid, 384 + maps.indexOf("0:v"));
    assert.deepEqual([...actual.payloads.keys()].sort(), actual.streams.map(stream => stream.pid).sort());
  });
}

it("assigns SDK PIDs in mapped order for video-only and mixed output", () => {
  const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1, includeAudio: true }));
  for (const tracks of [[doc.tracks[0]!], doc.tracks, [...doc.tracks].reverse()]) {
    for (const mpegtsStartPid of [256, 384]) {
      const actual = inspect(serializeMpegTs({ ...doc, tracks }, { mpegtsStartPid }));
      assert.deepEqual(actual.streams, tracks.map((track, i) => ({ type: track.type === "video" ? 27 : 15, pid: mpegtsStartPid + i })));
      assert.equal(actual.pcrPid, mpegtsStartPid + tracks.findIndex(track => track.type === "video"));
      assert.deepEqual([...actual.payloads.keys()].sort(), actual.streams.map(stream => stream.pid).sort());
    }
  }
  assert.throws(() => serializeMpegTs(doc, { mpegtsStartPid: 4095 }), /PID/);
});

async function run(volume: InstanceType<typeof Volume>, args: string[], sync: boolean, success: boolean) {
  if (sync) {
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), success ? "" : undefined);
    return;
  }
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
  assert.equal(result.exitCode === 0, success, stderr);
}
