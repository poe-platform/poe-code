import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const grouped = ["(", "xc:red", "-orient", "RightTop", ")", "(", "xc:red", "-orient", "LeftBottom", ")"];

// ImageMagick applies the active output setting even when its image was deleted.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const output of ["info", "tiff"] as const)
it.each([
  { name: "last setting", args: grouped, orientations: [8, 8] },
  { name: "deleted second image", args: [...grouped, "-delete", "1"], orientations: [8] },
  { name: "scoped settings", args: ["-respect-parentheses", ...grouped], orientations: [6, 8] },
  { name: "scoped deleted image", args: ["-respect-parentheses", ...grouped, "-delete", "1"], orientations: [6] },
  { name: "nested groups", args: ["(", ...grouped, ")"], orientations: [8, 8] },
  { name: "reset orientation", args: [...grouped, "+orient"], orientations: [6, 8] },
])(`${mode}, ${output}: $name`, async ({ args, orientations }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const argv = [...args, ...(output === "info" ? ["-format", "%[orientation]|", "info:/out"] : ["/out-%d.tiff"])];
  let stdout = "", stderr = "";
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(argv).args, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  }) : mode === "sync" ? runMagickCliSync(argv, files)
    : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(0);
  expect("stdout" in result ? result.stdout : stdout).toBe("");
  expect("stderr" in result ? result.stderr : stderr).toBe("");
  for (let index = 0; index < (output === "info" ? 1 : orientations.length); index++) {
    const path = output === "info" ? "/out" : `/out-${index}.tiff`;
    const bytes = mode === "buffered" || mode === "sync" ? files.get(path)! : await fs.readFile(path);
    if (output === "info") {
      expect(new TextDecoder().decode(bytes)).toBe(orientations.map(value => value === 6 ? "RightTop|" : "LeftBottom|").join(""));
    } else {
      expect(decodeImage(bytes)).toMatchObject({ width: 1, height: 1, orientation: orientations[index], data: Uint8Array.of(255, 0, 0, 255) });
    }
  }
});
