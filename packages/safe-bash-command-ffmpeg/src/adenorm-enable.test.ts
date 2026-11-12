import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [enable, hash] of [
    ["0", "80b67b115f8e28f3b67fddcd4cd1daac24a054603d1dd0cb13793a299a5dadfc"],
    ["1", "6f42824148278a31f3efe6e470dbba2e622d6cfc91d4133f7873640291f8da79"],
    ["gte(t\\,0.004)", "417a21999970a4983c8f328291a1e99057c56e96e4d173f0c07c4fc40fcf60cd"]
  ]) {
    it(`matches native adenorm enable=${enable}, graph=${graph}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/in.raw", new Uint8Array(1056));
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const filter = `asetnsamples=n=8:p=0,adenorm@a=level=-120:type=dc:enable=${enable}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          "-f", "f32le", "pipe:1"],
        command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write(chunk) { chunks.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(chunks);
      assert.equal(output.length, 2112);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
