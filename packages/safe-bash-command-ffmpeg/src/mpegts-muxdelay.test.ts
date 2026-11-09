import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseMpegTs } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/mpegts-muxdelay.m4a", import.meta.url));

// Inspect wire timestamps: parseMpegTs normalizes the presentation timeline.
function clocks(bytes: Uint8Array) {
  const pts: number[] = [];
  const pcr: number[] = [];
  let clockPid: number | undefined;
  let audioPid: number | undefined;
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = Buffer.from(bytes.subarray(offset, offset + 188));
    assert.equal(packet[0], 0x47);
    const pid = packet.readUInt16BE(1) & 8191;
    const adaptation = (packet[3]! >> 4) & 3;
    let payload = 4 + (adaptation & 2 ? 1 + packet[4]! : 0);
    if (pid === 0x1000) {
      payload += 1 + packet[payload]!;
      clockPid = packet.readUInt16BE(payload + 8) & 8191;
      audioPid = packet.readUInt16BE(payload + 13) & 8191;
    }
    if (pid !== audioPid) continue;
    if (adaptation & 2 && packet[4]! >= 7 && packet[5]! & 16) {
      assert.equal(pid, clockPid);
      pcr.push((packet.readUInt32BE(6) * 2 + (packet[10]! >> 7)) * 300 +
        ((packet[10]! & 1) << 8) + packet[11]!);
    }
    if (packet[1]! & 64 && adaptation & 1) {
      assert.equal(packet.readUIntBE(payload, 3), 1);
      const time = packet.subarray(payload + 9, payload + 14);
      pts.push((time[0]! & 14) * 536870912 + time[1]! * 4194304 +
        (time[2]! & 254) * 16384 + time[3]! * 128 + (time[4]! >> 1));
    }
  }
  return { pts, pcr };
}

async function run(options: string[], output = "/out.ts") {
  const volume = Volume.fromJSON({ "/input.m4a": input, "/out.ts": "existing output" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/input.m4a", "-map", "0:a", "-c", "copy", ...options, output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume };
}

// FFmpeg 7.0.2, mono AAC stream copy: default 0.7 s, zero and 0.2 s delay.
for (const [value, firstPts, firstPcr] of [[undefined, 126000, 18900000], ["0", 0, 0], ["0.2", 36000, 5400000]] as const) {
  it(`MPEG-TS muxdelay ${value ?? "default"} matches native clocks and preserves AAC`, async () => {
    const options = value === undefined ? [] : ["-muxdelay", value];
    const { result, stderr, volume } = await run(options);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = volume.readFileSync("/out.ts") as Buffer;
    const { pts, pcr } = clocks(bytes);
    assert.equal(pts[0], firstPts);
    assert.equal(pcr[0], firstPcr);
    assert.ok(pts.length > 1);
    assert.equal(pcr.length, pts.length);
    for (let i = 0; i < pts.length; i++) assert.equal(pts[i]! * 300 - pcr[i]!, firstPcr);
    assert.deepEqual(parseMpegTs(bytes).tracks[0]!.samples.map(s => Buffer.from(s.data)),
      parseMp4(input).tracks[0]!.samples.map(s => Buffer.from(s.data)));

    let syncBytes: Uint8Array | undefined;
    const sync = evalSyncFfmpeg(["-y", "-i", "/input.m4a", "-c", "copy", ...options, "/out.ts"],
      undefined, () => input, (_path, data) => { syncBytes = data; return true; });
    assert.notEqual(sync, undefined);
    assert.deepEqual(clocks(syncBytes!), { pts, pcr });
  });
}

for (const value of ["-1", "NaN", "Infinity", "bad", ""]) {
  it(`rejects invalid muxdelay ${JSON.stringify(value)} without replacing output`, async () => {
    const { result, stderr, volume } = await run(["-muxdelay", value]);
    assert.notEqual(result.exitCode, 0);
    assert.match(stderr, /muxdelay/);
    assert.equal(volume.readFileSync("/out.ts", "utf8"), "existing output");
  });
}

it("muxdelay is scoped to its output", async () => {
  const { result, stderr, volume } = await run(["-muxdelay", "0", "/zero.ts", "-c", "copy"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(clocks(volume.readFileSync("/zero.ts") as Buffer).pts[0], 0);
  assert.equal(clocks(volume.readFileSync("/out.ts") as Buffer).pts[0], 126000);
});

it("HLS retains its segment timeline without the standalone TS mux delay", async () => {
  const { result, stderr, volume } = await run([], "/out.m3u8");
  assert.equal(result.exitCode, 0, stderr);
  const { pts, pcr } = clocks(volume.readFileSync("/out0.ts") as Buffer);
  assert.equal(pts[0], 0);
  assert.equal(pcr[0], 0);
});
