import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Uint8Array.from([0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8, 0, 9, 0, 10]);

async function run(format: string, version: string, target: string, existing = false, overwrite = "-y") {
  const volume = Volume.fromJSON(existing ? { "/out.txt": "OLD" } : {});
  volume.writeFileSync("/in.raw", input);
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: [overwrite, "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      "-af", "anull", "-format_version", version, "-f", format, target],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, volume, stdout, stderr };
}

// Native FFmpeg 7.0.2 opens the output before applying muxer options.
for (const format of ["framemd5", "framehash"]) {
  for (const [version, exitCode] of [["0", 222], ["3", 222], ["0.9", 222], ["2.1", 222], ["1/0", 222], ["invalid", 234], ["", 234], ["1+", 234], ["0/0", 234], ["min(1,2)", 234]] as const) {
    for (const existing of [false, true]) {
      it(`${format} ${version} returns ${exitCode} with an empty ${existing ? "existing" : "new"} output`, async () => {
        const result = await run(format, version, "/out.txt", existing);
        assert.equal(result.exitCode, exitCode, result.stderr);
        assert.equal(result.volume.existsSync("/out.txt"), true);
        assert.equal(result.volume.readFileSync("/out.txt").length, 0);
        assert.equal(result.stdout, "");
        assert.deepEqual(new Uint8Array(result.volume.readFileSync("/in.raw") as Buffer), input);
      });
    }
    it(`${format} ${version} fails on stdout without creating a file`, async () => {
      const result = await run(format, version, "-");
      assert.equal(result.exitCode, exitCode, result.stderr);
      assert.equal(result.stdout, "");
      assert.deepEqual(result.volume.readdirSync("/"), ["in.raw"]);
    });
    it(`${format} ${version} respects -n before validating muxer options`, async () => {
      const result = await run(format, version, "/out.txt", true, "-n");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.volume.readFileSync("/out.txt", "utf8"), "OLD");
    });
  }
  for (const [version, expectedVersion] of [["1", 1], ["2", 2], ["1.5", 2], ["1+1", 2], ["min", 1], ["max", 2], ["default", 2]] as const) {
    it(`${format} version ${version} still emits the checksum report`, async () => {
      const result = await run(format, version, "/out.txt", true);
      assert.equal(result.exitCode, 0, result.stderr);
      const report = result.volume.readFileSync("/out.txt", "utf8") as string;
      assert.ok(report.includes(`#version: ${expectedVersion}\n`), report);
      const rows = report.split("\n").filter(line => line && !line.startsWith("#"));
      assert.deepEqual(rows.map(row => row.split(",").map(field => field.trim())), [[
        "0", "0", "0", "10", "20", createHash(format === "framemd5" ? "md5" : "sha256").update(input).digest("hex")
      ]]);
    });
  }
}
