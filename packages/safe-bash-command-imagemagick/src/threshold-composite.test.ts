import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI RGBA16 reference outputs.
const cases = [
  { label: "translucent defaults", inputs: ["xc:#b0205090", "xc:#3090c070"], expected: "6cfd2dc85234ffff" },
  { label: "zero threshold", inputs: ["xc:#b0205090", "xc:#3090c070", "-define", "compose:args=1x0"], expected: "4d1e49ab6e18ffff" },
  { label: "per-channel threshold", inputs: ["xc:#b0205090", "xc:#3090c070", "-define", "compose:args=1x0.000015"], expected: "4d1e2dc85234ffff" },
  { label: "half amount", inputs: ["xc:#b0205090", "xc:#3090c070", "-define", "compose:args=0.5x0"], expected: "5d0e3bb96026ffff" },
  { label: "clamped blend", inputs: ["xc:#b0205090", "xc:#3090c070", "-define", "compose:args=2x0"], expected: "412a654e7dc7ffff" },
  { label: "omitted threshold", inputs: ["xc:#b0205090", "xc:#3090c070", "-define", "compose:args=1"], expected: "6cfd2dc85234ffff" },
  { label: "opaque defaults", inputs: ["xc:#b02050", "xc:#3090c0"], expected: "b0b020205050ffff" },
  { label: "transparent destination", inputs: ["xc:#b0205000", "xc:#3090c070"], expected: "152a3f7e54a9ffff" },
  { label: "transparent source", inputs: ["xc:#b0205090", "xc:#3090c000"], expected: "63c712242d5affff" },
  { label: "both transparent", inputs: ["xc:#b0205000", "xc:#3090c000"], expected: "000000000000ffff" },
  { label: "merged layers", inputs: ["-background", "#395a8433", "xc:#a32c1988", "xc:#498cf482"], expected: "514324eb2536ffff" },
];

for (const route of ["command", "buffered", "sync"] as const)
for (const { label, inputs, expected } of cases) {
  it(`Threshold ${label} through ${route}`, async () => {
    const args = [...inputs, "-compose", "Threshold", ...(label === "merged layers" ? ["-layers", "merge"] : ["-composite"]),
      "-depth", "16", "-endian", "MSB", "rgba:-"];
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
