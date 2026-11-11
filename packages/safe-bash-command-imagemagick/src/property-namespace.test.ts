import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35: property: selects stored image properties only.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { edits: ["-set", "property:shift", "+2-1"], stdout: "+2-1|+2-1" },
    { edits: ["-set", "shift", "+2-1"], stdout: "+2-1|+2-1" },
    { edits: ["-set", "PROPERTY:Shift", "+2-1"], stdout: "+2-1|+2-1" },
    { edits: ["-set", "property:shift", "old", "-set", "shift", "new"], stdout: "new|new" },
    { edits: ["-set", "shift", "old", "-set", "property:shift", "new"], stdout: "new|new" },
    { edits: ["-set", "shift", "old", "-set", "property:shift", "%[property:shift]-%w"], stdout: "old-4|old-4" },
    { edits: ["-set", "property:shift", "old", "+set", "shift"], stdout: "|", warnings: ["shift", "property:shift"] },
    { edits: ["-set", "shift", "old", "+set", "PROPERTY:Shift"], stdout: "|", warnings: ["shift", "property:shift"] },
    { edits: ["-set", "option:shift", "option", "-set", "artifact:shift", "artifact"], stdout: "artifact|", warnings: ["property:shift"] },
    { edits: [], format: "%[property:width]|%[property:w]|%[property:fx:w]", stdout: "||", warnings: ["property:width", "property:w", "property:fx:w"] },
    { edits: ["-set", "property:shift", "value"], format: "%[shi*]|%[property:shi*]", stdout: "shift=value\n|" }
  ])(`shares the image-property namespace (${mode}): $edits`, async ({ edits, format, stdout: expected, warnings }) => {
    const input = new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...Array.from({ length: 36 }, (_, i) => (13 + 7 * i) % 256)]);
    const files = new Map([["/in.ppm", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const argv = ["/in.ppm", ...edits, "-format", format ?? "%[shift]|%[property:shift]", "info:"];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    expect("stderr" in result ? result.stderr : stderr).toBe(
      (warnings ?? []).map(key => `magick: unknown image property '%[${key}]'\n`).join("")
    );
  });
}
