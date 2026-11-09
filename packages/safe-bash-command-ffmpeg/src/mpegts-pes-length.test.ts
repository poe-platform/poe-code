import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const video = readFileSync(new URL("./fixtures/mpegts-pes.mp4", import.meta.url));
const audio = readFileSync(new URL("./fixtures/mpegts-service.m4a", import.meta.url));

function pesPackets(bytes: Buffer): Buffer[] {
  const packets: Buffer[] = [];
  const current = new Map<number, number>();
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet[0], 0x47);
    const pid = packet.readUInt16BE(1) & 0x1fff;
    const adaptation = (packet[3]! >> 4) & 3;
    if (!(adaptation & 1)) continue;
    const start = 4 + (adaptation & 2 ? 1 + packet[4]! : 0);
    const payload = packet.subarray(start);
    if (packet[1]! & 0x40) {
      current.delete(pid);
      if (payload.length < 6 || payload.readUIntBE(0, 3) !== 1) continue;
      current.set(pid, packets.length);
      packets.push(payload);
    } else {
      const index = current.get(pid);
      if (index !== undefined) packets[index] = Buffer.concat([packets[index]!, payload]);
    }
  }
  return packets;
}

async function run(input: Buffer, options: string[], sync: boolean) {
  const volume = Volume.fromJSON({ "/input.mp4": input });
  const args = ["-i", "/input.mp4", "-c", "copy", ...options];
  let success: boolean;
  let stderr = "";
  if (sync) {
    success = evalSyncFfmpeg(args, undefined, path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }) === "";
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
    success = result.exitCode === 0;
  }
  return { volume, success, stderr };
}

for (const sync of [false, true]) {
  for (const input of [video, audio]) {
    it(`writes native PES lengths without changing payloads, video=${input === video}, sync=${sync}`, async () => {
      let baseline: Buffer[] | undefined;
      for (const value of [undefined, "1", "0"]) {
        const { volume, success, stderr } = await run(input,
          [...(value === undefined ? [] : ["-omit_video_pes_length", value]), "/out.ts"], sync);
        assert.equal(success, true, stderr);
        const packets = pesPackets(volume.readFileSync("/out.ts") as Buffer);
        assert.ok(packets.length > 0);
        if (input === video) assert.equal(packets.length, 15);
        for (const packet of packets) {
          assert.equal(packet.readUInt16BE(4), input === video && value !== "0" ? 0 : packet.length - 6);
        }
        const payloads = packets.map(packet => packet.subarray(6));
        if (baseline) assert.deepEqual(payloads, baseline);
        baseline = payloads;
      }
    });
  }
  it(`rejects invalid PES omission before writing, sync=${sync}`, async () => {
    const { volume, success } = await run(video, ["-omit_video_pes_length", "invalid", "/out.ts"], sync);
    assert.equal(success, false);
    assert.equal(volume.existsSync("/out.ts"), false);
  });
}

it("resets PES omission to its default for each output", async () => {
  const { volume, success, stderr } = await run(video,
    ["-omit_video_pes_length", "0", "/length.ts", "-c", "copy", "/default.ts"], false);
  assert.equal(success, true, stderr);
  for (const packet of pesPackets(volume.readFileSync("/length.ts") as Buffer)) {
    assert.equal(packet.readUInt16BE(4), packet.length - 6);
  }
  for (const packet of pesPackets(volume.readFileSync("/default.ts") as Buffer)) assert.equal(packet.readUInt16BE(4), 0);
});
