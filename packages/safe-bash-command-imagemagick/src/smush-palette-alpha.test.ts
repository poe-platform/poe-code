import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains Palette source alpha when smushing.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["+smush", "-smush"])
for (const type of ["Palette", "PaletteAlpha"])
it.each([
    { name: "transparent background", background: "none", tail: [], coder: "rgba", expected: "12345678" },
    { name: "blue background", background: "blue", tail: [], coder: "rgba", expected: "0818afff" },
    { name: "extracted alpha", background: "none", tail: ["-alpha", "extract"], coder: "gray", expected: "78" },
])(`${mode} ${direction} ${type}: $name`, async ({ background, tail, coder, expected }) => {
    const argv = ["xc:#12345678", "-type", type, "-background", background, direction, "0", ...tail, "-depth", "8", `${coder}:/out`];
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
