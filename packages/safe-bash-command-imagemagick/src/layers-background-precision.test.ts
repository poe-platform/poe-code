import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Uncovered canvas samples, with opaque red and blue source pixels unchanged.
for (const route of ["command", "retained", "buffered", "sync"] as const)
for (const operation of [["-layers", "merge"], ["-layers", "flatten"], ["-layers", "mosaic"], ["-flatten"], ["-mosaic"]])
for (const background of ["123456789abc789a", "1111222233334444"])
it(`${route}: ${operation.join(" ")} preserves RGBA16 background #${background}`, async () => {
    const merge = operation.includes("merge");
    const argv = ["(", "xc:red", "-repage", merge ? "3x1-1+0" : "3x1+0+0", ")",
        "(", "xc:blue", "-repage", merge ? "3x1+1+0" : "3x1+2+0", ")",
        "-background", `#${background}`, ...operation, "-depth", "16", "-endian", "MSB", "rgba:-"];
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = route === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : route === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, route === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = route === "command" ? Buffer.concat(stdout)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes)).toEqual(Buffer.from(`ffff00000000ffff${background}00000000ffffffff`, "hex"));
});
