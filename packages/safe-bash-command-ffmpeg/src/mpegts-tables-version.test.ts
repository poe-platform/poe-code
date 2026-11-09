import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/mpegts-tables-version.mp4", import.meta.url));

function inspectTs(bytes: Buffer, expected: number) {
  const tables = new Set<number>();
  const media: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += 188) {
    const packet = bytes.subarray(offset, offset + 188);
    assert.equal(packet[0], 0x47);
    const pid = packet.readUInt16BE(1) & 0x1fff;
    if (![0, 17, 4096].includes(pid)) { media.push(packet); continue; }
    const adaptation = (packet[3]! >> 4) & 3;
    if (!(adaptation & 1)) continue;
    let k = 4 + (adaptation & 2 ? 1 + packet[4]! : 0);
    assert.ok(packet[1]! & 64);
    k += 1 + packet[k]!;
    const section = packet.subarray(k, k + 3 + (packet.readUInt16BE(k + 1) & 4095));
    tables.add(section[0]!);
    assert.equal((section[5]! >> 1) & 31, expected);
    assert.equal(section[5]! & 0xc1, 0xc1, "reserved and current/next bits");
    let crc = 0xffffffff;
    for (const byte of section) {
      crc ^= byte << 24;
      for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc < 0 ? 0x04c11db7 : 0);
    }
    assert.equal(crc >>> 0, 0, "valid table CRC");
  }
  assert.deepEqual([...tables].sort((a, b) => a - b), [0, 2, 66]);
  return createHash("sha256").update(Buffer.concat(media)).digest("hex");
}

async function run(options: string[]) {
  const volume = Volume.fromJSON({ "/in.mp4": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.mp4", "-map", "0:v:0", "-c", "copy", ...options],
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

for (const value of [undefined, "0", "7", "31"]) {
  it(`writes table version ${value ?? "default"} in every PAT, PMT and SDT`, async () => {
    const { result, volume, stderr } = await run([...(value ? ["-tables_version", value] : []), "/out.ts"]);
    assert.equal(result.exitCode, 0, stderr);
    const baseline = await run(["/out.ts"]);
    assert.equal(inspectTs(volume.readFileSync("/out.ts") as Buffer, Number(value ?? 0)),
      inspectTs(baseline.volume.readFileSync("/out.ts") as Buffer, 0));
  });
  it(`writes table version ${value ?? "default"} through the synchronous API`, () => {
    const volume = Volume.fromJSON({ "/in.mp4": input });
    assert.equal(evalSyncFfmpeg(["-i", "/in.mp4", "-c:v", "copy", ...(value ? ["-tables_version", value] : []), "/out.ts"], undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    inspectTs(volume.readFileSync("/out.ts") as Buffer, Number(value ?? 0));
  });
}

it("scopes table versions to each output", async () => {
  const { result, volume, stderr } = await run(["-tables_version", "7", "/first.ts", "-c", "copy", "/second.ts"]);
  assert.equal(result.exitCode, 0, stderr);
  inspectTs(volume.readFileSync("/first.ts") as Buffer, 7);
  inspectTs(volume.readFileSync("/second.ts") as Buffer, 0);
});

for (const value of ["-1", "32", "1.5", "invalid", ""]) {
  it(`rejects invalid table version ${JSON.stringify(value)} before writing`, async () => {
    const { result, volume } = await run(["-tables_version", value, "/out.ts"]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.existsSync("/out.ts"), false);
  });
}
