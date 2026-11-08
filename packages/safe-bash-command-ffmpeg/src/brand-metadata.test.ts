import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const majorBrand of ["M4A ", "isom"]) {
    for (const source of [undefined, "0", "-1", "1"]) {
      it(`exports ${JSON.stringify(majorBrand)} brand metadata (sync=${sync}, source=${source})`, async () => {
        const base = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1, includeAudio: true }));
        const compatibleBrands = majorBrand === "M4A " ? ["M4A ", "isom", "iso2"] : ["isom", "iso2", "mp41"];
        const input = serializeMp4({ ...base, majorBrand, minorVersion: 512, compatibleBrands,
          tracks: base.tracks.filter(track => track.type === "audio"), metadata: { title: "Audio" } });
        const volume = Volume.fromJSON({ "/in.m4a": Buffer.from(input), "/other.meta": ";FFMETADATA1\ntitle=Other\n" });
        const args = ["-v", "error", "-i", "/in.m4a", "-f", "ffmetadata", "-i", "/other.meta",
          "-map_chapters", "-1", ...(source === undefined ? [] : ["-map_metadata", source]), "-f", "ffmetadata", "/out.meta"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
        const lines = (volume.readFileSync("/out.meta", "utf8") as string).split("\n");
        if (source === undefined || source === "0") {
          for (const line of [`major_brand=${majorBrand}`, "minor_version=512", `compatible_brands=${compatibleBrands.join("")}`, "title=Audio"]) {
            assert.ok(lines.includes(line), `Missing ${JSON.stringify(line)} in ${JSON.stringify(lines)}`);
          }
        } else {
          assert.ok(!lines.some(line => ["major_brand=", "minor_version=", "compatible_brands="].some(prefix => line.startsWith(prefix))));
          assert.equal(lines.includes("title=Other"), source === "1");
        }
        assert.ok(lines.includes("encoder=Lavf61.7.100"));
        assert.ok(!lines.includes("[CHAPTER]"));
      });
    }
  }
}
