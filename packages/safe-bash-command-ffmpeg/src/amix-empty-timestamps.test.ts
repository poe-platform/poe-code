import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: an empty first input leaves the mixer clock at NOPTS.
for (const empty of ["atrim=end_sample=0", "aselect=0"]) {
  for (const swapped of [false, true]) {
    for (const selector of ["", "isnan(pts)", "not(isnan(pts))"]) {
      it(`preserves empty-input amix timestamps: ${empty}, swapped=${swapped}, selector=${selector}`, async () => {
        const pcm = Buffer.from("65006600", "hex");
        const volume = Volume.fromJSON({ "/in.raw": pcm });
        const output: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const inputs = swapped ? "[1:a][x]" : "[x][1:a]";
        const graph = `[0:a]${empty}[x];${inputs}amix=normalize=0,ashowinfo` +
          (selector ? `,aselect='${selector}'` : "");
        const result = await createFfmpegCommand().execute({
          args: ["-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            "-filter_complex", graph, "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        const stderr = Buffer.concat(errors).toString();
        assert.equal(result.exitCode, 0, stderr);
        const audible = !selector || (selector === "isnan(pts)" ? !swapped : swapped);
        assert.equal(Buffer.concat(output).toString("hex"), audible ? pcm.toString("hex") : "");
        assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"))
          .map(line => line.split(" pts:")[1]!.split(" ")[0]), [swapped ? "0" : "NOPTS"]);
      });
    }
  }
}
