import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI RGB outputs.
const cases = [
  { inputs: ["(", "left.ppm", ")", "right.ppm"], expected: "0a6f79288d9746abb5" },
  { inputs: ["(", "left.ppm", "-negate", ")", "right.ppm"], expected: "f56f79d78d97b9abb5" },
  { inputs: ["left.ppm", "(", "right.ppm", "-negate", ")"], expected: "0a908628726846544a" },
  { inputs: ["left.ppm", "right.ppm"], expected: "0a6f79288d9746abb5" },
  { inputs: ["right.ppm", "left.ppm"], expected: "65141e83323ca1505a" },
  { inputs: ["(", "(", "left.ppm", "-negate", ")", ")", "right.ppm"], expected: "f56f79d78d97b9abb5" },
];

for (const route of ["command", "buffered", "sync"] as const)
for (const { inputs, expected } of cases) {
  it(`composite ${inputs.join(" ")} through ${route}`, async () => {
    const files = new Map([
      ["left.ppm", new TextEncoder().encode("P3\n3 1\n255\n10 20 30 40 50 60 70 80 90\n")],
      ["right.ppm", new TextEncoder().encode("P3\n3 1\n255\n101 111 121 131 141 151 161 171 181\n")],
      ["out.raw", new TextEncoder().encode("KEEP")],
      ["side.raw", new TextEncoder().encode("KEEP")],
    ]);
    const args = ["composite", "-compose", "CopyRed", ...inputs, "rgb:out.raw"];
    const fs = createMemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
    let stdout = "", stderr = "";
    const result = route === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : route === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
    expect(Buffer.from(route === "command" ? await fs.readFile("/side.raw") : files.get("side.raw")!).toString()).toBe("KEEP");
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(Buffer.from(route === "command" ? await fs.readFile("/out.raw") : files.get("out.raw")!).toString("hex")).toBe(expected);
  });
}
