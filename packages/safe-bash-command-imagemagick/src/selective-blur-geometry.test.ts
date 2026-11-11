import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const)
it.each(["2x3+100%", "2,3,100%", "2/3+100%", "(2x3+100%)"])(`accepts native selective blur geometry %s (${mode})`, async geometry => {
    const args = ["xc:#406070", "xc:#809080", "+append", "-set", "option:radius", "2", "-selective-blur", geometry, "-depth", "8", "rgb:-"];
    let output: Uint8Array;
    if (mode === "command") {
        const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
        const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } },
            stderr: { write: async chunk => { errors.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } }
        });
        expect(Buffer.concat(errors).toString()).toBe("");
        expect(result.exitCode).toBe(0);
        output = Buffer.concat(chunks);
    } else {
        const result = mode === "sync" ? runMagickCliSync(args, new Map()) : await runMagickCli(args, new Map());
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        output = result.stdoutBytes!;
    }
    // Complete RGB8 output from ImageMagick 7.1.2-35 Q16-HDRI.
    expect(Buffer.from(output).toString("hex")).toBe("597376677d7a");
});

for (const retained of [false, true])
it.each(["501,1,10%", "501/1+10%", "(501x1+10%)", "0,10000,10%"])(`bounds native selective blur geometry %s (retained=${retained})`, async geometry => {
    const result = await runMagickCli(["xc:red", "-selective-blur", geometry, "rgb:-"],
        retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Selective blur radius exceeds 500");
    expect(result.stdoutBytes?.length ?? 0).toBe(0);
});
