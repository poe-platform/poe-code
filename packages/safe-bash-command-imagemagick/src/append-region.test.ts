import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 output.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { name: "vertical append clears region", operations: ["-append"], hex: "7fbf3f7f".repeat(6) },
    { name: "horizontal append clears region", operations: ["+append"], hex: "7fbf3f7f".repeat(6) },
    { name: "without append preserves region", operations: [], hex: "7fbf3f7f" + "483c5480".repeat(5) },
    { name: "vertical append with explicitly cleared region", operations: ["-append", "+region"], hex: "7fbf3f7f".repeat(6) },
    { name: "horizontal append with explicitly cleared region", operations: ["+append", "+region"], hex: "7fbf3f7f".repeat(6) },
])(`${mode}: $name`, async ({ operations, hex }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const keep = new TextEncoder().encode("KEEP");
    await fs.writeFile("/out", keep);
    files.set("/out", keep);
    const argv = ["(", "-size", "2x3", "xc:#8040c080", "-region", "1x1+0+0", ")",
        ...operations, "-negate", "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
