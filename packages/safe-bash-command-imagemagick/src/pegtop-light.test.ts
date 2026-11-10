import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI RGBA16, including transparent inputs.
const cases = [
  { base: "#204080", source: "#d0e0f0", expected: "438a70b0af27ffff" },
  { base: "#395a8433", source: "#498cf4ee", expected: "080313642401f258" },
  { base: "#b02050", source: "#3090c0", expected: "8e8e27627038ffff" },
  { base: "#395a8433", source: "#a32c1988", expected: "0fdb14b7208da06d" },
  { base: "#395a8400", source: "#a32c1988", expected: "a3a32c2c19198888" },
  { base: "#395a8433", source: "#a32c1900", expected: "39395a5a84843333" },
  { base: "#395a8400", source: "#a32c1900", expected: "0000000000000000" },
];

for (const operation of ["composite", "flatten", "merge"])
for (const { base, source, expected } of cases) {
  const inputs = operation === "composite" ? [`xc:${base}`, `xc:${source}`] : ["-background", base, `xc:${source}`];
  const args = [...inputs, "-compose", "PegtopLight",
    ...(operation === "composite" ? ["-composite"] : ["-layers", operation]), "-depth", "16", "-endian", "MSB", "rgba:-"];
  for (const route of ["command", "buffered", "sync"] as const) {
    it(`PegtopLight ${route} ${operation} ${base} ${source}`, async () => {
      let stdout = "";
      const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write() {} },
      }) : route === "sync" ? runMagickCliSync(args, new Map()) : await runMagickCli(args, new Map());
      expect(result.exitCode).toBe(0);
      const hex = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes).toString("hex") : stdout;
      expect(hex).toBe(expected);
    });
  }
}

it("PegtopLight merges multiple translucent layers", async () => {
  const result = await runMagickCli(["-background", "#395a8433", "xc:#a32c1988", "xc:#498cf482",
    "-compose", "PegtopLight", "-layers", "merge", "-depth", "16", "-endian", "MSB", "rgba:-"], new Map());
  expect(result.exitCode).toBe(0);
  expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("080b0c9d18b2d126");
});
