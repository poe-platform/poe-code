import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const fixture = "00100020003000400050006000700040";
for (const [options, repetitions, expected] of [
  ["enable=0", 1, [fixture]],
  ["enable=1", 1, ["00300040005000600070ff7fff7f00e0"]],
  ["enable='gte(t,0.256)'", 512, ["001000200030", "001000200030", "00b000400050", "00b000400050"]],
  ["enable='lt(n,1)+gte(n,3)'", 512, ["003000400050", "001000200030", "00b000400050", "00b000400050"]],
  ["i=-1:enable='gte(t,0.256)'", 512, ["001000200030", "001000200030", "00280024002a", "303018280c2c"]]
] as const) {
  for (const complex of [false, true]) {
    it(`crystalizer preserves frame timeline and history: ${options} (${complex ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", Buffer.from(fixture.repeat(repetitions), "hex"));
      let stderr = "";
      const filter = `crystalizer=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
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
      assert.equal(stderr, "");
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, repetitions * 16);
      expected.forEach((hex, frame) => {
        assert.equal(output.subarray(frame * 2048, frame * 2048 + hex.length / 2).toString("hex"), hex);
      });
    });
  }
}
