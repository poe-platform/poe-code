import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/mpegts-service.m4a", import.meta.url));

// Native FFmpeg 7.0.2 service audit: AAC payload hash is identical for TV and radio.
function inspectTs(bytes: Buffer) {
  let pmtPid = -1, audioPid = -1, streamType = -1;
  let serviceType = -1;
  const payloads: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet[0], 0x47);
    const pid = ((packet[1]! & 31) << 8) | packet[2]!;
    const start = !!(packet[1]! & 64), adaptation = (packet[3]! >> 4) & 3;
    if (!(adaptation & 1)) continue;
    let k = 4 + (adaptation & 2 ? 1 + packet[4]! : 0);
    if (start && pid === 17) {
      k += 1 + packet[k]!;
      const section = packet.subarray(k, k + 3 + (packet.readUInt16BE(k + 1) & 4095));
      assert.equal(section[0], 0x42);
      let crc = 0xffffffff;
      for (const byte of section) {
        crc ^= byte << 24;
        for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc < 0 ? 0x04c11db7 : 0);
      }
      assert.equal(crc >>> 0, 0, "valid SDT CRC");
      assert.equal(section.readUInt16BE(11), 1, "service matches PAT program");
      const end = 16 + (section.readUInt16BE(14) & 4095);
      for (let d = 16; d < end; d += 2 + section[d + 1]!) {
        if (section[d] === 0x48) serviceType = section[d + 2]!;
      }
      continue;
    }
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
  return { serviceType, streamType, hash: createHash("sha256").update(Buffer.concat(payloads)).digest("hex") };
}

async function run(options: string[]) {
  const volume = Volume.fromJSON({ "/in.m4a": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.m4a", "-map", "0:a", "-c", "copy", ...options],
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

for (const [value, expected] of [[undefined, 1], ["digital_tv", 1], ["digital_radio", 2], ["2", 2]] as const) {
  it(`writes the MPEG-TS service type ${value ?? "default"} without changing AAC`, async () => {
    const { result, volume, stderr } = await run([...(value ? ["-mpegts_service_type", value] : []), "/out.ts"]);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(inspectTs(volume.readFileSync("/out.ts") as Buffer), {
      serviceType: expected, streamType: 15,
      hash: "62f7cae9d59c82f6a34706d5c2ade132898dbde47d8b482d4d69b57795431215"
    });
  });
}

it("scopes the service type to each output", async () => {
  const { result, volume, stderr } = await run(["-mpegts_service_type", "digital_radio", "/radio.ts", "-c", "copy", "/tv.ts"]);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(inspectTs(volume.readFileSync("/radio.ts") as Buffer).serviceType, 2);
  assert.equal(inspectTs(volume.readFileSync("/tv.ts") as Buffer).serviceType, 1);
});

for (const value of ["invalid", "0", "256", "1.5"]) {
  it(`rejects invalid service type ${value} before writing`, async () => {
    const { result, volume } = await run(["-mpegts_service_type", value, "/out.ts"]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.existsSync("/out.ts"), false);
  });
}

for (const value of ["digital_tv", "digital_radio"]) {
  it(`writes service type ${value} through the synchronous API`, () => {
    const volume = Volume.fromJSON({ "/in.m4a": input });
    assert.equal(evalSyncFfmpeg(["-i", "/in.m4a", "-c:a", "copy", "-mpegts_service_type", value, "/out.ts"], undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    assert.equal(inspectTs(volume.readFileSync("/out.ts") as Buffer).serviceType, value === "digital_radio" ? 2 : 1);
  });
}
