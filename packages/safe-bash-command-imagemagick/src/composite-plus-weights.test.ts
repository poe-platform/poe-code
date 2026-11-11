import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI RGB outputs.
const cases = [
  { options: ["+blend"], expected: "0a141e28323c46505a" },
  { options: ["+dissolve"], expected: "0a141e28323c46505a" },
  { options: ["+watermark"], expected: "0a141e28323c46505a" },
  { options: ["-blend", "40", "+blend"], expected: "6f8397abbfd3e7fbff" },
  { options: ["-dissolve", "40", "+dissolve"], expected: "0a141e28323c46505a" },
  { options: ["-watermark", "40", "+watermark"], expected: "0000000000003f4953" },
  { options: ["-blend", "40"], expected: "414b555f69737d8791" },
  { options: ["-blend", "40", "+blend", "-blend", "40"], expected: "414b555f69737d8791" },
  { options: ["-compose", "Blend"], expected: "6f8397abbfd3e7fbff" },
  { options: [], expected: "0a141e28323c46505a" },
];

for (const route of ["command", "buffered", "sync"] as const)
for (const { options, expected } of cases) {
  it(`composite ${options.join(" ") || "defaults"} through ${route}`, async () => {
    const files = new Map([
      ["left.ppm", new TextEncoder().encode("P3\n3 1\n255\n10 20 30 40 50 60 70 80 90\n")],
      ["right.ppm", new TextEncoder().encode("P3\n3 1\n255\n101 111 121 131 141 151 161 171 181\n")],
      ["out.raw", new TextEncoder().encode("KEEP")],
    ]);
    const args = ["composite", ...options, "left.ppm", "right.ppm", "rgb:out.raw"];
    const fs = createMemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
    let stdout = "", stderr = "";
    const result = route === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : route === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, files);
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(Buffer.from(route === "command" ? await fs.readFile("/out.raw") : files.get("out.raw")!).toString("hex")).toBe(expected);
  });
}
