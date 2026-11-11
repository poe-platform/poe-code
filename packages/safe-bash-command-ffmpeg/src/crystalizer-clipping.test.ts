import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [values, expected] of [
  [["0", "false", "FALSE", "no", "No", "off", "OFF", "n", "N", "disable", "DISABLED", "-0"], "001800200028003000380040004800f0"],
  [["1", "true", "True", "yes", "YeS", "on", "ON", "y", "Y", "enable", "ENABLED", "+01"], "001800200028003000380040004000f0"],
  [["invalid", "2", "-1", "auto", "1.0", "0x1", "1e0", "+", "Trueish", "Nope"], null]
] as const) {
  for (const value of values) {
    for (const option of [`c=${value}`, `2:${value}`]) {
      for (const complex of [false, true]) {
        it(`parses crystalizer clipping ${JSON.stringify(option)} (${complex ? "graph" : "simple"})`, async () => {
          const volume = Volume.fromJSON({ "/out.raw": "existing" });
          volume.writeFileSync("/in.raw", Buffer.from("00100020003000400050006000700040", "hex"));
          const filter = `crystalizer=${option},volume=0.5`;
          const filters = complex
            ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
            : ["-af", filter];
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw", ...filters, "-f", "s16le", "/out.raw"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          if (expected === null) {
            assert.notEqual(result.exitCode, 0);
            assert.ok(stderr.includes("crystalizer: invalid clipping option"), stderr);
            assert.equal(volume.readFileSync("/out.raw", "utf8"), "existing");
          } else {
            assert.equal(result.exitCode, 0, stderr);
            assert.equal(stderr, "");
            assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected, "hex"));
          }
        });
      }
    }
  }
}
