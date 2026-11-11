import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) for (const destination of sync ? ["/out.ffmeta"] : ["/out.ffmeta", "pipe:1"]) for (const flags of [[], ["-bitexact"], ["-fflags", "bitexact"], ["-fflags", "+bitexact"]]) for (const position of ["input", "output", "both"]) for (const encoder of ["", "encoder=Old\n"]) {
  it(`exports FFmetadata muxer encoder and chapter ticks ${JSON.stringify(flags)} ${position} ${destination} (${encoder ? "existing encoder" : "no encoder"}) (${sync ? "sync" : "async"})`, async () => {
    const chapters = "[CHAPTER]\nTIMEBASE=1/48000\nSTART=1\nEND=49\ntitle=beat\n" +
      "[CHAPTER]\nTIMEBASE=1001/30000\nSTART=2\nEND=3\ntitle=frame\n";
    const volume = Volume.fromJSON({ "/in.ffmeta": `;FFMETADATA1\ntitle=Meeting\n${encoder}${chapters}` });
    const args = ["-y", "-v", "error", ...(position !== "output" ? flags : []), "-f", "ffmetadata", "-i", "/in.ffmeta", ...(position !== "input" ? flags : []), "-f", "ffmetadata", destination];
    let stdout = "";
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
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    assert.equal(destination === "pipe:1" ? stdout : volume.readFileSync(destination, "utf8"), `;FFMETADATA1\ntitle=Meeting\n${flags.length && position !== "input" ? "" : "encoder=Lavf61.7.100\n"}${chapters}`);
  });
}
