import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, row-major RGBA8.
const cases = [
  { label: "translucent pixels", inputs: ["xc:#aa443380", "xc:#2468acb0"], compose: "SoftDodge", expected: "703839d8" },
  { label: "opaque pixels", inputs: ["xc:#aa4433", "xc:#2468ac"], compose: "SoftDodge", expected: "c6739dff" },
  { label: "clamped highlights", inputs: ["xc:#94daf5", "xc:#f6cc83"], compose: "SoftDodge", expected: "ffffffff" },
  { label: "white destination", inputs: ["xc:white", "xc:black"], compose: "SoftDodge", expected: "ffffffff" },
  { label: "black destination and white source", inputs: ["xc:black", "xc:white"], compose: "SoftDodge", expected: "000000ff" },
  { label: "white source", inputs: ["xc:#aa4433", "xc:white"], compose: "SoftDodge", expected: "ffffffff" },
  { label: "transparent source", inputs: ["xc:#aa443380", "xc:#2468ac00"], compose: "SoftDodge", expected: "aa443380" },
  { label: "transparent destination", inputs: ["xc:#aa443300", "xc:#2468acb0"], compose: "SoftDodge", expected: "000000b0" },
  { label: "transparent pixels", inputs: ["xc:#aa443300", "xc:#2468ac00"], compose: "SoftDodge", expected: "00000000" },
  { label: "offset layers", inputs: ["-size", "3x1", "xc:#aa443380", "(", "-size", "2x1", "xc:#2468acb0", "-repage", "3x1+1+0", ")", "-background", "#33553370"], compose: "SoftDodge", expected: "2f3c23b8294233e9294233e9", flatten: true },
  { label: "Over control", inputs: ["xc:#aa443380", "xc:#2468acb0"], compose: "Over", expected: "3d6196d8" },
  { label: "Dst control", inputs: ["xc:#aa443380", "xc:#2468acb0"], compose: "Dst", expected: "aa443380" },
];

for (const route of ["command", "buffered", "retained", "sync"] as const)
for (const { label, inputs, compose, expected, flatten } of cases) {
  it(`${compose}: ${label} through ${route}`, async () => {
    const argv = ["-size", "1x1", ...inputs, "-compose", compose, flatten ? "-flatten" : "-composite", "-depth", "8", "rgba:-"];
    const args = createCommandArguments(argv);
    const fs = new MemoryFileSystem();
    let stdout = "";
    const result = route === "command" ? await createMagickCommand().execute({
      command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
      stderr: { async write() {} },
    }) : route === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, route === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    const hex = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
      ? Buffer.from(result.stdoutBytes).toString("hex") : stdout;
    expect(hex).toBe(expected);
  });
}
