import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 output from native FFmpeg 7.0.2 for [2000, -3000, 4000, -5000] repeated four times.
const input = Buffer.from("d00748f4a00f78ec".repeat(4), "hex");
for (const [filter, expected] of [
  ["asendcmd=c='0.001 aemphasis@eq enable 0',aemphasis@eq=level_out=0.5",
    "4102bffef30046ff05fce4ffb30034ffd00748f4a00f78ecd00748f4a00f78ec"],
  ["asendcmd=c='0.0005 aemphasis@eq enable 0;0.0015 aemphasis@eq enable 1',aemphasis@eq=level_out=0.5",
    "4102bffef30046ffd00748f4a00f78ecd00748f4a00f78ec05fce4ffb30034ff"],
  ["asendcmd=c='0.00075 aemphasis enable 0',aemphasis@eq=level_out=0.5",
    "4102bffef30046ff05fce4ffb30034ffd00748f4a00f78ecd00748f4a00f78ec"],
  ["asendcmd=c='0.0005 aemphasis@eq enable 0;0.001 aemphasis@eq enable invalid;0.0015 aemphasis@eq enable 1',aemphasis@eq=level_out=0.5",
    "4102bffef30046ffd00748f4a00f78ecd00748f4a00f78ec05fce4ffb30034ff"],
  ["asendcmd=c='0 aemphasis@eq enable lt(n,2)',aemphasis@eq=level_out=0.5:enable=0",
    "4102bffef30046ff05fce4ffb30034ffd00748f4a00f78ecd00748f4a00f78ec"],
  ["aemphasis=level_out=0.5:enable='lt(n,1)+gte(n,3)'",
    "4102bffef30046ffd00748f4a00f78ecd00748f4a00f78ec05fce4ffb30034ff"],
  ["asendcmd=c='0.001 aemphasis@other enable 0',aemphasis@eq=level_out=0.5",
    "4102bffef30046ff05fce4ffb30034ff43fc91ff0e01dcfe92fc4eff4401b2fe"]
] as const) {
  for (const graph of [false, true]) {
    it(`matches native aemphasis enable PCM: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chunks: Buffer[] = [];
      let stderr = "";
      const chain = `asetnsamples=n=4:p=0,${filter}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw", ...(graph
          ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(chunks).toString("hex"), expected);
    });
  }
}
