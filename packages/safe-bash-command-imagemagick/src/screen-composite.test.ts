import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Reference RGBA8 bytes from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
  { inputs: ["xc:none", "xc:#12457880"], expected: "12457880" },
  { inputs: ["xc:#12457880", "xc:#ab8900c0"], expected: "988d45e0" },
  { inputs: ["xc:#124578", "xc:#ab8900"], expected: "b1a978ff" },
  { inputs: ["xc:#12457880", "xc:none"], expected: "12457880" },
  { inputs: ["xc:none", "xc:none"], expected: "00000000" },
];

for (const layers of [false, true])
for (const { inputs, expected } of [...cases, ...(layers ? [{ inputs: ["xc:#12457880"], expected: "12457880" }] : [])]) {
  const args = [...inputs, "-background", "none", "-compose", "Screen",
    ...(layers ? ["-layers", "merge"] : ["-composite"]), "-depth", "8", "rgba:-"];
  for (const route of ["command", "buffered", "sync"] as const) {
    it(`Screen ${route} layers=${layers} preserves RGB for ${inputs.join(" ")}`, async () => {
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
