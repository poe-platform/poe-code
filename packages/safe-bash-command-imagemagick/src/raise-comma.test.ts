import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI rejects 2,1 but accepts 2x1,3.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const option of ["-raise", "+raise"])
for (const destination of ["-", "/out"])
it.each(["2,1", "oops", "2x1", "2x1,3"])(`${mode}: ${option} %s to ${destination}`, async geometry => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", original]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", original);
    const argv = ["-size", "8x7", "xc:#385060", option, geometry, "-depth", "8", `rgb:${destination}`];
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
    const invalid = geometry === "2,1" || geometry === "oops";
    expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(invalid ? 1 : 0);
    const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    const saved = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
    if (invalid) {
        expect("stderr" in result ? result.stderr : stderr).toContain(geometry === "2,1" ? "invalid geometry" : `invalid argument for option '${option}'`);
        expect(stdout).toHaveLength(0);
        expect(saved).toEqual(original);
    } else {
        const output = destination === "-" ? stdout : saved;
        expect(output).toHaveLength(168);
        expect(createHash("sha256").update(output).digest("hex")).toBe(option === "-raise"
            ? "8d17c8013c42d1557981c9adc1a8e87781cb4192e83c21b6297c8fd13718942a"
            : "189f1783601fc713a1ee6039bc8da6d3eba7ca20bba86b13dd24f9fc9d719315");
    }
});
