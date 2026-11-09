import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAdtsStream, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2, mono 48 kHz AAC tone, 0.72 seconds:
// ffmpeg -i input.m4a -map 0:a:0 -c:a copy -f segment -segment_time 0.2
//   -segment_list adts.csv adts%02d.aac (repeat with m4a.csv and m4a%02d.m4a).
// Packet hashes include ADTS headers for .aac, raw access units for .m4a.
const input = readFileSync(new URL("./fixtures/segment-aac.m4a", import.meta.url));
const native = JSON.parse(readFileSync(new URL("./fixtures/segment-aac-native.json", import.meta.url), "utf8")) as
  Record<string, { csv: string; packets: string[][] }>;

async function run(volume: Volume, output: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/input.m4a", "-map", "0:a:0", "-c:a", "copy", ...output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr };
}

for (const extension of ["aac", "m4a"]) {
  const prefix = extension === "aac" ? "adts" : "m4a";
  const output = ["-f", "segment", "-segment_time", "0.2", "-segment_list", `/${prefix}.csv`, `/${prefix}%02d.${extension}`];
  it(`copies AAC into ${extension} segments at native packet boundaries without losing payloads`, async () => {
    const volume = Volume.fromJSON({ "/input.m4a": input });
    const before = volume.toJSON();
    assert.equal(evalSyncFfmpeg(["-i", "/input.m4a", "-c:a", "copy", ...output], undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    assert.deepEqual(volume.toJSON(), before);
    const result = await run(volume, output);
    assert.equal(result.exitCode, 0, result.stderr);
    const names = volume.readdirSync("/").map(String).filter(name => name.endsWith(`.${extension}`) && name !== "input.m4a").sort();
    assert.deepEqual(names, [0, 1, 2, 3].map(index => `${prefix}0${index}.${extension}`));
    const bytes = names.map(name => volume.readFileSync(`/${name}`) as Buffer);
    const packets = bytes.map(data => extension === "aac" ? parseAdtsStream(data, true).frames
      : parseMp4(data).tracks[0]!.samples.map(sample => sample.data));
    assert.deepEqual(packets.map(samples => samples.length), [10, 9, 10, 6]);
    assert.deepEqual(packets.map(samples => samples.map(data => `SHA256:${createHash("sha256").update(data).digest("hex")}`)),
      native[extension]!.packets);
    assert.equal(volume.readFileSync(`/${prefix}.csv`, "utf8"), native[extension]!.csv);
    const plain = await run(volume, [`/plain.${extension}`]);
    assert.equal(plain.exitCode, 0, plain.stderr);
    if (extension === "aac") {
      assert.deepEqual(Buffer.concat(bytes), volume.readFileSync("/plain.aac"));
    } else {
      assert.deepEqual(packets.flat().map(data => Buffer.from(data)),
        parseMp4(volume.readFileSync("/plain.m4a") as Buffer).tracks[0]!.samples.map(sample => Buffer.from(sample.data)));
    }
  });

  it(`protects existing ${extension} segments and lists unless overwrite is requested`, async () => {
    const volume = Volume.fromJSON({ "/input.m4a": input, [`/${prefix}01.${extension}`]: "keep", [`/${prefix}.csv`]: "keep list" });
    const before = volume.toJSON();
    assert.equal((await run(volume, output)).exitCode, 1);
    assert.deepEqual(volume.toJSON(), before);
    const result = await run(volume, ["-y", ...output]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(volume.readFileSync(`/${prefix}.csv`, "utf8"), native[extension]!.csv);
  });
}
