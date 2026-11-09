import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseMpegTs } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) for (const metadata of [
  {}, { service_name: "Workshop" }, { service_provider: "Studio" },
  { service_name: "Workshop", service_provider: "Studio" }
]) {
  it(`${sync ? "sync" : "async"} MPEG-TS stream copy advertises ${JSON.stringify(metadata)} without changing AAC`, async () => {
    const input = readFileSync(new URL("./fixtures/adts-mpeg-version.m4a", import.meta.url));
    const volume = Volume.fromJSON({ "/in.m4a": input });
    const args = ["-y", "-i", "/in.m4a", ...(sync ? [] : ["-map", "0:a"]), "-c", "copy",
      ...Object.entries(metadata).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]), "/out.ts"];
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
    const output = parseMpegTs(new Uint8Array(volume.readFileSync("/out.ts") as Buffer));
    assert.deepEqual(output.services.get(output.programs[0]!.programNumber), {
      service_name: metadata.service_name ?? "Service01",
      service_provider: metadata.service_provider ?? "FFmpeg"
    });
    assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data),
      parseMp4(new Uint8Array(input)).tracks[0]!.samples.map(sample => sample.data));
  });
}
