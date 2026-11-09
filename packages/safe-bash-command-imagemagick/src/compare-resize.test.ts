import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, using a 3x2 image and its nearest-neighbor 6x4 enlargement.
const pixels = [230, 15, 64, 25, 180, 150, 120, 10, 215, 50, 120, 85, 150, 25, 35, 90, 210, 160];
const base = Uint8Array.from([...new TextEncoder().encode("P6\n3 2\n255\n"), ...pixels]);
const double = Uint8Array.from([...new TextEncoder().encode("P6\n6 4\n255\n"),
  ...Array.from({ length: 24 }, (_, i) => {
    const offset = (Math.floor(i / 12) * 3 + Math.floor(i % 6 / 2)) * 3;
    return pixels.slice(offset, offset + 3);
  }).flat()]);
const cases = [
  { inputs: ["base.ppm", "base.ppm"], metric: "0 (0)", size: [3, 2] },
  { inputs: ["(", "double.ppm", "-resize", "50%", ")", "base.ppm"], metric: "4705.85 (0.0718067)", size: [3, 2] },
  { inputs: ["(", "double.ppm", "-resize", "3x2!", ")", "base.ppm"], metric: "4705.85 (0.0718067)", size: [3, 2] },
  { inputs: ["double.ppm", "-resize", "50%", "base.ppm"], metric: "247.018 (0.00376925)", size: [2, 1] },
  { inputs: ["double.ppm", "-resize", "3x2!", "base.ppm"], metric: "4705.85 (0.0718067)", size: [3, 2] },
  { inputs: ["base.ppm", "-resize", "100%", "base.ppm"], metric: "0 (0)", size: [3, 2] },
  { inputs: ["-resize", "50%", "double.ppm", "base.ppm"], metric: "13001.4 (0.198389)", size: [3, 2] },
  { inputs: ["double.ppm", "base.ppm", "-resize", "50%"], metric: "13001.4 (0.198389)", size: [3, 2] },
  { inputs: ["(", "(", "double.ppm", "-resize", "50%", ")", ")", "base.ppm"], metric: "4705.85 (0.0718067)", size: [3, 2] },
  { inputs: ["(", "double.ppm", "-resize", "50%", ")", "(", "base.ppm", ")"], metric: "4705.85 (0.0718067)", size: [3, 2] },
  { inputs: ["(", "double.ppm", "-resize", "50%", ")", "base.ppm", "-resize", "50%"], metric: "247.018 (0.00376925)", size: [2, 1] },
];

for (const mode of ["buffered", "sync", "retained", "compare", "magick"] as const) {
  const run = async (inputs: string[]) => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["base.ppm", base], ["double.ppm", double], ["diff.ppm", original]]);
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
    const args = ["-metric", "RMSE", ...inputs, "diff.ppm"];
    let stdout = "", stderr = "";
    const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
    const result = mode === "compare" || mode === "magick" ? await command.execute({
      command: command.name, args: createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]).args,
      cwd: "/", env: {}, fs: filesystem, stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runCompareCliSync(args, files)
      : await runCompareCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    return { exitCode: result.exitCode, stdout: "stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout,
      stderr: "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr,
      output: mode === "buffered" || mode === "sync" ? files.get("diff.ppm")! : await filesystem.readFile("/diff.ppm"), original };
  };
  for (const fixture of cases) {
    it(`${mode} compare resizes ${fixture.inputs.join(" ")}`, async () => {
      const result = await run(fixture.inputs);
      expect(result.exitCode, result.stderr).toBe(fixture.metric === "0 (0)" ? 0 : 1);
      if (fixture.metric === "0 (0)") expect(result.stderr.trim()).toBe(fixture.metric);
      else {
        // Native HDRI rounds each filter pass to float quantum samples.
        const actual = result.stderr.trim().split(" "), expected = fixture.metric.split(" ");
        expect(Number(actual[0])).toBeCloseTo(Number(expected[0]), 2);
        expect(Number(actual[1]!.slice(1, -1))).toBeCloseTo(Number(expected[1]!.slice(1, -1)), 7);
      }
      expect(result.stdout).toBe("");
      const image = decodeImage(result.output);
      expect([image.width, image.height]).toEqual(fixture.size);
    });
  }
  for (const inputs of [
    ["base.ppm", "base.ppm", "-resize", "bogus"],
    ["base.ppm", "base.ppm", "-resize", ""],
    ["(", "base.ppm", "-resize", "50%", "base.ppm"],
    ["base.ppm", ")", "base.ppm"],
  ]) {
    it(`${mode} compare preserves the destination for invalid resize or grouping ${JSON.stringify(inputs)}`, async () => {
      const result = await run(inputs);
      expect(result.exitCode).toBe(2);
      expect(result.output).toEqual(result.original);
    });
  }
}
