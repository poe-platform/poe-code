import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, serializeMpegTs } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/mpegts-pid.m4a", import.meta.url));
// FFmpeg 7.0.2: -i input.m4a -map 0:a -c copy -muxrate 500000 -pcr_period 100 out.ts
const native = readFileSync(new URL("./fixtures/mpegts-clock-native-100.ts.bin", import.meta.url));

function inspect(bytes: Uint8Array) {
  let pmt = -1, clockPid = -1;
  const clocks: { packet: number; ticks: number }[] = [];
  const audio: Uint8Array[] = [];
  const continuity = new Map<number, number>();
  let nulls = 0;
  assert.equal(bytes.length % 188, 0);
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = Buffer.from(bytes.subarray(offset, offset + 188));
    assert.equal(packet[0], 0x47);
    const pid = packet.readUInt16BE(1) & 8191;
    const adaptation = (packet[3]! >> 4) & 3;
    const start = Boolean(packet[1]! & 64);
    if (pid === 8191) { nulls++; continue; }
    const cc = packet[3]! & 15;
    if (continuity.has(pid)) assert.equal(cc, (continuity.get(pid)! + (adaptation & 1)) & 15);
    continuity.set(pid, cc);
    if ((adaptation & 2) && packet[4]! >= 7 && (packet[5]! & 16)) {
      assert.equal(pid, clockPid, "PCR belongs to the PMT clock PID");
      const base = packet.readUInt32BE(6) * 2 + (packet[10]! >> 7);
      const extension = ((packet[10]! & 1) << 8) | packet[11]!;
      clocks.push({ packet: offset / 188, ticks: base * 300 + extension });
    }
    if (!(adaptation & 1)) continue;
    let pos = 4 + ((adaptation & 2) ? 1 + packet[4]! : 0);
    if (start && (pid === 0 || pid === pmt)) {
      pos += 1 + packet[pos]!;
      if (pid === 0) pmt = packet.readUInt16BE(pos + 10) & 8191;
      else clockPid = packet.readUInt16BE(pos + 8) & 8191;
    } else if (pid === clockPid) {
      if (start) {
        assert.equal(packet.readUIntBE(pos, 3), 1);
        pos += 9 + packet[pos + 8]!;
      }
      audio.push(packet.subarray(pos));
    }
  }
  return { clocks, audio: Buffer.concat(audio), nulls };
}

function verifyClock(bytes: Uint8Array, period: number) {
  const actual = inspect(bytes);
  assert.deepEqual(actual.audio, inspect(native).audio, "copied ADTS audio is unchanged");
  assert.ok(actual.nulls > 0, "fixed-rate muxing fills idle slots");
  assert.ok(actual.clocks.length > 5);
  const packetTicks = 188 * 8 * 27000000 / 500000;
  for (let i = 1; i < actual.clocks.length; i++) {
    const previous = actual.clocks[i - 1]!, current = actual.clocks[i]!;
    const elapsed = current.ticks - previous.ticks;
    assert.equal(elapsed, (current.packet - previous.packet) * packetTicks, "PCR follows the byte clock");
    assert.ok(elapsed > 0 && elapsed <= period * 27000 + packetTicks * 3, `PCR gap ${elapsed / 27000}ms`);
    if (i > 1 && i < actual.clocks.length - 1) assert.ok(elapsed >= period * 27000 - packetTicks * 3, "period does not collapse to per-PES PCR");
  }
  return actual;
}

it("schedules SDK PCR at 20 and 100 ms with the same 500 kbit/s transport rate", () => {
  const doc = parseMp4(input);
  const fast = verifyClock(serializeMpegTs(doc, { muxRate: 500000, pcrPeriod: 20 }), 20);
  const slow = verifyClock(serializeMpegTs(doc, { muxRate: 500000, pcrPeriod: 100 }), 100);
  assert.ok(fast.clocks.length > slow.clocks.length * 3);
  // Recorded native 20 ms output starts at these packet positions and clock value.
  assert.deepEqual(fast.clocks.slice(0, 4).map(clock => clock.packet), [3, 7, 14, 20]);
  assert.equal(fast.clocks[0]!.ticks, 19148400);
});

it("validates native PCR timing and preserves automatic and disabled modes", () => {
  const reference = verifyClock(native, 100);
  assert.equal(reference.clocks.length, 8);
  assert.deepEqual(reference.clocks.slice(0, 4).map(clock => clock.packet), [3, 36, 67, 100]);
  const doc = parseMp4(input);
  assert.deepEqual(serializeMpegTs(doc, { muxRate: 500000, pcrPeriod: -1 }),
    serializeMpegTs(doc, { muxRate: 500000, pcrPeriod: 20 }));
  for (const muxRate of [1, 500000]) {
    assert.equal(inspect(serializeMpegTs(doc, { muxRate, pcrPeriod: 0 })).clocks.length, 0);
  }
  for (const pcrPeriod of [-2, 0.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => serializeMpegTs(doc, { pcrPeriod }), /pcr_period/);
  }
});

for (const sync of [false, true]) {
  it(`accepts PCR periods in fixed-rate command output (sync=${sync})`, async () => {
    const counts: number[] = [];
    for (const period of [20, 100]) {
      const volume = Volume.fromJSON({ "/input.m4a": input });
      await run(volume, ["-y", "-i", "/input.m4a", ...(sync ? [] : ["-map", "0:a"]), "-c", "copy", "-muxrate", "500000", "-pcr_period", String(period), "/out.ts"], sync, true);
      counts.push(verifyClock(volume.readFileSync("/out.ts") as Buffer, period).clocks.length);
    }
    assert.ok(counts[0]! > counts[1]! * 3);
  });
  it(`accepts pcr_period without muxrate (sync=${sync})`, async () => {
    const volume = Volume.fromJSON({ "/input.m4a": input });
    await run(volume, ["-y", "-i", "/input.m4a", "-c", "copy", "-pcr_period", "100", "/out.ts"], sync, true);
    assert.deepEqual(inspect(volume.readFileSync("/out.ts") as Buffer).audio, inspect(native).audio);
  });
  for (const [option, value] of [["-pcr_period", "bad"], ["-pcr_period", "-2"], ["-pcr_period", "2147483648"], ["-muxrate", "-1"], ["-muxrate", "NaN"]]) {
    it(`rejects ${option} ${value} before overwriting (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/input.m4a": input, "/out.ts": "KEEP" });
      await run(volume, ["-y", "-i", "/input.m4a", "-c", "copy", option!, value!, "/out.ts"], sync, false);
      assert.equal(volume.readFileSync("/out.ts", "utf8"), "KEEP");
    });
  }
}

it("forwards PCR period to HLS MPEG-TS segments", async () => {
  for (const period of [20, 100]) {
    const volume = Volume.fromJSON({ "/input.m4a": input });
    await run(volume, ["-y", "-i", "/input.m4a", "-c", "copy", "-muxrate", "500000",
      "-pcr_period", String(period), "-f", "hls", "-hls_time", "1", "/index.m3u8"], false, true);
    verifyClock(volume.readFileSync("/index0.ts") as Buffer, period);
  }
});

it("checks output limits before allocating constant-rate padding", () => {
  assert.throws(() => serializeMpegTs(parseMp4(input), { muxRate: 500000, pcrPeriod: 20, limits: { maxOutputBytes: 2000 } }), /maxOutputBytes/);
});

async function run(volume: InstanceType<typeof Volume>, args: string[], sync: boolean, success: boolean) {
  if (sync) {
    assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), success ? "" : undefined);
    return;
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode === 0, success, stderr);
}
