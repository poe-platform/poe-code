import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Chapter tables captured from native FFmpeg 7.0.2 with the same arguments.
const cases = [
  { name: "output half tick", before: [], after: ["-ss", "0.05"], bounds: [0, 5] },
  { name: "input half tick", before: ["-ss", "0.05"], after: [], bounds: [0, 5] },
  { name: "negative half-tick offset", before: ["-itsoffset", "-0.05"], after: [], bounds: [0, 5] },
  { name: "positive half-tick offset", before: ["-itsoffset", "0.05"], after: [], bounds: [2, 7] },
  { name: "below half tick", before: [], after: ["-ss", "0.049999"], bounds: [1, 6] },
  { name: "above half tick", before: [], after: ["-ss", "0.050001"], bounds: [0, 5] },
  { name: "whole-tick seek", before: [], after: ["-ss", "0.1"], bounds: [0, 5] },
  { name: "whole-tick offset", before: ["-itsoffset", "-0.1"], after: [], bounds: [0, 5] },
  { name: "combined seeks", before: ["-ss", "0.03"], after: ["-ss", "0.03"], bounds: [0, 5] },
  { name: "combined offset and seek", before: ["-itsoffset", "-0.03"], after: ["-ss", "0.03"], bounds: [0, 5] },
  { name: "cancelled output seek", before: ["-itsoffset", "0.05"], after: ["-ss", "0.05"], bounds: [1, 6] },
  { name: "cancelled input seek", before: ["-ss", "0.05", "-itsoffset", "0.05"], after: [], bounds: [1, 6] },
  { name: "negative output seek", before: [], after: ["-ss", "-0.05"], bounds: [2, 7] },
  { name: "half-tick duration", before: [], after: ["-t", "0.15"], bounds: [1, 2] },
  { name: "duration ending at chapter start", before: [], after: ["-t", "0.05"], bounds: [1, 1] },
  { name: "seek ending at chapter end", before: [], after: ["-ss", "0.649999"], bounds: [0, 0] },
  { name: "seek past chapter end", before: [], after: ["-ss", "0.65"], bounds: [] },
  { name: "separately rounded duration", before: [], after: ["-ss", "0.03", "-t", "0.03"], bounds: [] },
  { name: "copy timestamps", before: ["-copyts", "-ss", "0.05"], after: [], bounds: [1, 6] },
  { name: "rational output seek", timeBase: "3/10", before: [], after: ["-ss", "0.15"], bounds: [0, 5] },
  { name: "rational input seek", timeBase: "3/10", before: ["-ss", "0.15"], after: [], bounds: [0, 5] },
  { name: "rational input offset", timeBase: "3/10", before: ["-itsoffset", "-0.15"], after: [], bounds: [0, 5] }
];

for (const sync of [false, true]) {
  for (const { name, before, after, bounds, timeBase = "1/10" } of cases) {
    it(`rounds chapter offsets before shifting: ${name} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({
        "/in.meta": `;FFMETADATA1\n[CHAPTER]\nTIMEBASE=${timeBase}\nSTART=1\nEND=6\ntitle=A\n`
      });
      const args = ["-y", "-v", "error", ...before, "-f", "ffmetadata", "-i", "/in.meta",
        ...after, "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
      let stdout = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        stdout = volume.readFileSync("/out.meta", "utf8") as string;
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return volume.readFileSync(path); } },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
      }
      assert.equal(stdout, ";FFMETADATA1\n" + (bounds.length === 0 ? "" :
        `[CHAPTER]\nTIMEBASE=${timeBase}\nSTART=${bounds[0]}\nEND=${bounds[1]}\ntitle=A\n`));
    });
  }
}
