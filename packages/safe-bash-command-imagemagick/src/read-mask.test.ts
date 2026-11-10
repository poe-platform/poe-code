import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  for (const scenario of ["selected", "removed", "negated", "threshold", "empty"] as const) {
    it(`read mask ${scenario} (retained=${retained})`, async () => {
      const png = (levels: number[]) => sharp(new Uint8Array(levels.flatMap(value => [value, value, value])), { raw: { width: levels.length, height: 1, channels: 3 } }).png().toBuffer();
      const files = new Map([["/levels.png", await png([64, 128, 192])], ["/mask.png", await png(scenario === "empty" ? [0, 0, 0] : scenario === "threshold" ? [0, 127, 255] : [0, 255, 255])]]);
      const fs = new MemoryFileSystem();
      for (const [path, bytes] of files) await fs.writeFile(path, bytes);
      const result = await runMagickCli(["/levels.png", "-read-mask", "/mask.png", ...(scenario === "removed" ? ["+read-mask"] : scenario === "negated" ? ["-negate"] : []), "-format", "%[fx:mean]|%[min]|%[max]|%[hex:p{0,0}]", "info:"], retained ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toEqual({ exitCode: 0, stderr: "", stdout: ({ selected: "0.627451|16448|49344|404040", removed: "0.501961|16448|49344|404040", negated: "0.372549|16191|49087|BFBFBF", threshold: "0.752941|16448|49344|404040", empty: "0|16448|49344|404040" })[scenario] });
    });
  }
}

for (const retained of [false, true]) {
  it(`uses masked statistics across chunks and clones (retained=${retained})`, async () => {
    const width = 2051;
    const png = (pixels: number[]) => sharp(Uint8Array.from(pixels), { raw: { width, height: 1, channels: 3 } }).png().toBuffer();
    const levels = await png(Array.from({ length: width }, (_, i) => Array(3).fill(i < 2048 ? 64 : 192)).flat());
    const mask = await png(Array.from({ length: width }, (_, i) => Array(3).fill(i < 2048 ? 0 : 255)).flat());
    const fs = new MemoryFileSystem(), files = new Map([["/levels.png", levels], ["/mask.png", mask]]);
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const input = retained ? { filesystem: fs, cwd: "/" } : files;
    expect(await runMagickCli(["/levels.png", "-read-mask", "/mask.png", "-duplicate", "40", "-format", "%[fx:mean]|%[fx:standard_deviation]", "info:"], input)).toEqual({ exitCode: 0, stderr: "", stdout: "0.752941|0".repeat(41) });
    expect((await runMagickCli(["/levels.png", "-read-mask", "/mask.png", "-channel", "RGB", "-fx", "mean", "/out.png"], input)).exitCode).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data.slice(0, 4)]).toEqual([0, 192, 192, 255]);
  });
}

it("public command measures only white-selected pixels", async () => {
  const fs = new MemoryFileSystem();
  for (const [path, values] of [["/levels.png", [64, 128, 192]], ["/mask.png", [0, 255, 255]]] as const) {
    await fs.writeFile(path, await sharp(Uint8Array.from(values.flatMap(value => [value, value, value])), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer());
  }
  const argumentValues = createCommandArguments(["/levels.png", "-read-mask", "/mask.png", "-format", "%[fx:mean]|%[mean]|%[fx:standard_deviation]", "info:"]);
  let stdout = "", stderr = "";
  const result = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result).toEqual({ exitCode: 0 });
  expect(stderr).toBe("");
  expect(stdout).toBe("0.627451|41120|0.17747");
});
