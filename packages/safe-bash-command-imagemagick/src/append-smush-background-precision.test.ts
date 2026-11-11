import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI preserves every background quantum in the uncovered pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operator of ["-append", "+append", "-smush", "+smush"])
it.each([
    ["#123456789abc789a", "123456789abc789a"],
    ["#123456789abc", "123456789abcffff"],
    ["#1111222233334444", "1111222233334444"],
])(`${mode} ${operator}: preserves padding samples for %s`, async (background, padding) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["-size", "2x1", "xc:red", "-size", "1x2", "xc:blue", "-background", background,
        operator, ...(operator.endsWith("smush") ? ["0"] : []), "-depth", "16", "-endian", "MSB", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    const red = "ffff00000000ffff", blue = "00000000ffffffff";
    expect(Buffer.from(bytes).toString("hex")).toBe(operator.startsWith("-")
        ? red + red + blue + padding + blue + padding
        : red + red + blue + padding + padding + blue);
});
