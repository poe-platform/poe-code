import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMpegTs } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/frame-checksum-tone.m4a", import.meta.url));
for (const sync of [false, true]) {
  for (const value of [undefined, "1", "42", "256", "65535", "0", "-1", "65536", "1.5", "bad", ""]) {
    it(`sets MPEG-TS service ID ${value ?? "default"} (sync=${sync})`, async () => {
      const valid = value === undefined || ["1", "42", "256", "65535"].includes(value);
      const volume = Volume.fromJSON({ "/input.m4a": input, "/out.ts": "keep existing output" });
      const args = ["-y", "-i", "/input.m4a", ...(sync ? [] : ["-map", "0:a"]), "-c", "copy",
        ...(value === undefined ? [] : ["-mpegts_service_id", value]), "/out.ts"];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        if (valid) assert.equal(result, "");
        else assert.notEqual(result, "");
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
        if (valid) assert.equal(result.exitCode, 0, stderr);
        else assert.notEqual(result.exitCode, 0);
      }
      if (!valid) {
        assert.equal(volume.readFileSync("/out.ts", "utf8"), "keep existing output");
        return;
      }
      const output = parseMpegTs(volume.readFileSync("/out.ts") as Buffer);
      const serviceId = value === undefined ? 1 : Number(value);
      assert.equal(output.programs[0]!.programNumber, serviceId);
      assert.equal(output.programs[0]!.pmtPid, 4096);
      assert.ok(output.services.has(serviceId));
    });
  }
}
