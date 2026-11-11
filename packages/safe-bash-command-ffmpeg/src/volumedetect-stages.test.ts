import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["volumedetect", "volumedetect,ashowinfo", "ashowinfo,volumedetect", "volumedetect@first,ashowinfo,volumedetect@second="]) {
  it(`${filter} reports initialization before frames and measurements after frames`, async () => {
    const input = Buffer.from("00400000002000100008000400020001", "hex");
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.raw", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", filter, "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(fs.readFileSync("/out.raw"), input);
    const prefixes = filter.includes("@second") ? ["[volumedetect@first] ", "[volumedetect@second] "] : [""];
    assert.equal(stderr, prefixes.map(prefix => `${prefix}n_samples: 0\n`).join("")
      + (filter.includes("ashowinfo") ? "[ashowinfo] n:0 pts:0 pts_time:0 fmt:s16 channels:1 chlayout:mono rate:8000 nb_samples:8 checksum:0603007F plane_checksums: [ 0603007F ]\n" : "")
      + prefixes.map(prefix => `${prefix}n_samples: 8\n${prefix}mean_volume: -13.8 dB\n${prefix}max_volume: -6.0 dB\n`).join(""));
  });
}
