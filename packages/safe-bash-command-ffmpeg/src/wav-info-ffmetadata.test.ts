import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [name, fixture, title] of [
  ["before data", "UklGRkYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAATElTVBIAAABJTkZPSU5BTQYAAABGaXJzdABkYXRhCAAAAAAA6AMY/NAH", "First"],
  ["after data", "UklGRkYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQgAAAAAAOgDGPzQB0xJU1QSAAAASU5GT0lOQU0GAAAARmlyc3QA", "First"],
  ["repeated INFO lists", "UklGRmIAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAATElTVBIAAABJTkZPSU5BTQYAAABGaXJzdABMSVNUFAAAAElORk9JTkFNBwAAAFNlY29uZAAAZGF0YQgAAAAAAOgDGPzQBw==", "Second"],
  ["no INFO list", "UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQgAAAAAAOgDGPzQBw==", undefined]
] as const) {
  for (const suppress of [false, true]) {
    for (const sync of [false, true]) {
      it(`exports WAV INFO to FFmetadata: ${name}, suppress=${suppress}, sync=${sync}`, async () => {
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(fixture, "base64") });
        const args = ["-v", "error", "-y", "-i", "/in.wav", ...(suppress ? ["-map_metadata", "-1"] : []), "-f", "ffmetadata", "/out.meta"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
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
        const output = volume.readFileSync("/out.meta", "utf8") as string;
        const [header, ...lines] = output.trim().split("\n");
        assert.equal(header, ";FFMETADATA1");
        const { encoder, ...tags } = Object.fromEntries(lines.map(line => line.split("=")));
        assert.equal(encoder, "Lavf61.7.100");
        assert.deepEqual(tags, suppress || title === undefined ? {} : { title });
      });
    }
  }
}
