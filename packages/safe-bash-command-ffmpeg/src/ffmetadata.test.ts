import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const timebase of ["", "TIMEBASE=1/8000\n"]) {
  it(`exports a quarter-second FFmetadata chapter with ${timebase ? "explicit" : "default"} time base`, async () => {
    const volume = Volume.fromJSON({
      "/in.ffmeta": `;FFMETADATA1\n[CHAPTER]\n${timebase}START=0\nEND=${timebase ? 2000 : 250000000}\ntitle=Demo\n`
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "ffmetadata", "-i", "/in.ffmeta", "-f", "ffmetadata", "/out.ffmeta"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(volume.readFileSync("/out.ffmeta", "utf8"),
      `;FFMETADATA1\n\n[CHAPTER]\nTIMEBASE=1/${timebase ? 8000 : 1000000000}\nSTART=0\nEND=${timebase ? 2000 : 250000000}\ntitle=Demo\n`);
  });
}
