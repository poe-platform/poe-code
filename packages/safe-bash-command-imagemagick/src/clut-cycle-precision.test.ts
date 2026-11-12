import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: cycling preserves mapped RGB and disables alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const { name, input, expected } of [
    {
        name: "mapped colors",
        input: ["(", "xc:#173e5970", "xc:#b56829cf", "+append", ")", "(", "xc:#7258b433", "xc:#2ba761cf", "+append", ")", "-clut", "-cycle", "1"],
        expected: "31b192c29041ffff5dfe853a7b9dffff",
    },
    {
        name: "uncycled mapping",
        input: ["(", "xc:#173e5970", "xc:#b56829cf", "+append", ")", "(", "xc:#7258b433", "xc:#2ba761cf", "+append", ")", "-clut"],
        expected: "5dfe853a7b9d77fc31b192c29041b254",
    },
    {
        name: "explicit mapped colors",
        input: ["xc:#5dfe853a7b9d77fc", "xc:#31b192c29041b254", "+append", "-cycle", "1"],
        expected: "31b192c29041ffff5dfe853a7b9dffff",
    },
])
it(`retains 16-bit ${name} (${mode})`, async () => {
    const argv = [...input, "-depth", "16", "-endian", "MSB", `rgba:${mode === "command" ? "-" : "/out"}`];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const actual = mode === "command" ? stdout
        : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
    expect(actual).toBe(expected);
});
