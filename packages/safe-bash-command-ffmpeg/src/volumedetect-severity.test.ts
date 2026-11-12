import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const option of ["-v", "-loglevel"]) {
  for (const filter of ["volumedetect", "volumedetect@left"]) {
    for (const level of ["level+info", "info", "level+warning"]) {
      it(`${filter} labels every measurement with ${option} ${level} without changing PCM`, async () => {
        const input = Buffer.alloc(2000);
        for (let offset = 0; offset < input.length; offset += 2) input.writeInt16LE(-32768, offset);
        const fs = Volume.fromJSON({ "/in.raw": input });
        let stderr = "";
        const stdout: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", option, level, "-f", "s16le", "-ar", "8000",
            "-ac", "2", "-i", "/in.raw", "-af", filter, "-f", "s16le", "-"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(Buffer.concat(stdout), input);
        assert.deepEqual(fs.readFileSync("/in.raw"), input);
        const prefix = (filter === "volumedetect@left" ? "[volumedetect@left] " : "")
          + (level === "level+info" ? "[info] " : "");
        const measurements = ["n_samples: 0", "n_samples: 1000", "mean_volume: 0.0 dB",
          "max_volume: 0.0 dB", "histogram_0db: 1000"];
        assert.equal(stderr, level === "level+warning" ? ""
          : measurements.map(line => `${prefix}${line}\n`).join(""));
      });
    }
  }
}
