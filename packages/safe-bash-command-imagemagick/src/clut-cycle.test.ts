import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: CLUT makes indexed sources DirectClass.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { indexed: true, cycle: true, info: false, expected: "319290ff5e857bff" },
    { indexed: true, cycle: false, info: false, expected: "5e857b78319290b2" },
    { indexed: false, cycle: true, info: false, expected: "319290ff5e857bff" },
    { indexed: true, cycle: false, info: true, expected: "DirectClass sRGB Alpha 2" },
])(`${mode}: CLUT indexed=$indexed cycle=$cycle info=$info`, async ({ indexed, cycle, info, expected }) => {
    const argv = ["(", "xc:#173e5970", "xc:#b56829cf", "+append", ...(indexed ? ["-colors", "2"] : []), ")",
        "(", "xc:#7258b433", "xc:#2ba761cf", "+append", ")", "-clut", ...(cycle ? ["-cycle", "1"] : []),
        ...(info ? ["-format", "%r %k", "info:"] : ["-depth", "8", `rgba:${mode === "command" ? "-" : "/out"}`])];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += info ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const actual = mode === "command" ? stdout : info && "stdout" in result ? result.stdout
        : Buffer.from(mode === "retained" ? await fs.readFile("/out") : files.get("/out")!).toString("hex");
    expect(info ? actual.trim() : actual).toBe(expected);
});
