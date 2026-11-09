import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/vp9-split.mkv", import.meta.url));
// Native FFmpeg 7.0.2 stream copy, inspected with ffprobe -show_packets -show_data_hash sha256.
const expected = JSON.parse(readFileSync(new URL("./fixtures/vp9-autobsf-packets.json", import.meta.url), "utf8"));

function packets(bytes: Uint8Array, extension = "mkv") {
  const track = (extension === "mp4" ? parseMp4(bytes) : parseMkv(bytes)).tracks[0]!;
  return track.samples.map(sample => ({
    pts: sample.pts * 1000 / track.timescale,
    size: String(sample.data.length),
    data_hash: `SHA256:${createHash("sha256").update(sample.data).digest("hex")}`
  }));
}

async function copy(args: string[], sync = false) {
  const volume = Volume.fromJSON({ "/in.mkv": input });
  if (sync) {
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
  } else {
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
    assert.equal(result.exitCode, 0, stderr);
  }
  return volume;
}

for (const sync of [false, true]) for (const extension of ["mkv", "webm", "mp4"]) {
  for (const flag of [undefined, "+autobsf", "-autobsf", "autobsf", "bitexact", "+bitexact"]) {
    it(`${sync ? "sync" : "async"} ${extension} VP9 copy matches native packets with fflags=${flag ?? "default"}`, async () => {
      const output = `/out.${extension}`;
      const volume = await copy(["-v", "error", "-y", "-i", "/in.mkv", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy",
        ...(flag ? ["-fflags", flag] : []), output], sync);
      const actual = packets(volume.readFileSync(output) as Buffer, extension);
      const reference = flag === "-autobsf" || flag === "bitexact" ? expected.disabled : expected.enabled;
      if (extension === "mp4") {
        // MP4 adjusts duplicate timestamps to its time base; compare the stored payloads.
        assert.deepEqual(actual.map(packet => packet.data_hash),
          reference.map((packet: { data_hash: string }) => packet.data_hash));
      } else {
        assert.deepEqual(actual, reference);
      }
    });
  }
  it(`${sync ? "sync" : "async"} input fflags do not disable output autobsf for ${extension}`, async () => {
    const output = `/out.${extension}`;
    const volume = await copy(["-y", "-fflags", "-autobsf", "-i", "/in.mkv", "-c", "copy", output], sync);
    assert.deepEqual(packets(volume.readFileSync(output) as Buffer, extension), expected.enabled);
  });
}

it("resets autobsf between output files", async () => {
  const volume = await copy(["-y", "-i", "/in.mkv",
    "-c", "copy", "-fflags", "-autobsf", "/disabled.mkv",
    "-c", "copy", "-fflags", "+autobsf", "/enabled.mkv",
    "-c", "copy", "/default.mkv"]);
  for (const name of ["disabled", "enabled", "default"]) {
    assert.deepEqual(packets(volume.readFileSync(`/${name}.mkv`) as Buffer),
      name === "disabled" ? expected.disabled : expected.enabled);
  }
});
