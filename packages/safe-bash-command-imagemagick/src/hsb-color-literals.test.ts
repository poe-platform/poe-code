import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI raw output, including the HSL control.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        ...["hsb", "hsv"].flatMap(kind => [
            ...["xc", "canvas"].flatMap(prefix => [
                { args: [`${prefix}:${kind}(180,50%,80%)`, "-depth", "8", "rgba:-"], hex: "66ccccff" },
                { args: [`${prefix}:${kind}a(180,50%,80%,0.5)`, "-depth", "8", "rgba:-"], hex: "66cccc80" },
                { args: [`${prefix}:${kind}a(180,50%,80%,0.5)`, "-depth", "16", "-endian", "MSB", "rgba:-"], hex: "6666cccccccc8000" },
            ]),
            { args: [`xc:${kind}a(180,50%,80%,0.25%)`, "-depth", "8", "rgba:-"], hex: "66cccca3" },
            { args: [`xc:${kind}a(180,50%,80%,50%)`, "-depth", "8", "rgba:-"], hex: "66ccccff" },
            ...[
                ["0,100%,100%", "ff0000ff"],
                ["60,100%,100%", "ffff00ff"],
                ["120,100%,100%", "00ff00ff"],
                ["240,100%,100%", "0000ffff"],
                ["300,100%,100%", "ff00ffff"],
                ["480,100%,100%", "00ff00ff"],
                ["-120,100%,100%", "0000ffff"],
                ["180,0%,80%", "ccccccff"],
                ["180,50,80", "405050ff"],
                ["180,50%,80%,0.5", "66ccccff"],
            ].map(([components, hex]) => ({ args: [`xc:${kind}(${components})`, "-depth", "8", "rgba:-"], hex })),
        ]),
        ...["hsb(0,100%,100%)", "hsv(0,100%,100%)", "hsba(0,100%,100%,1)", "hsva(0,100%,100%,1)", "hsl(0,100%,50%)"].flatMap(endpoint => [
            { args: ["xc:red", "-color-threshold", `${endpoint}-${endpoint}`, "-depth", "8", "gray:-"], hex: "ff" },
            { args: ["xc:black", "-color-threshold", `${endpoint}-${endpoint}`, "-depth", "8", "gray:-"], hex: "00" },
        ]),
        { args: ["xc:hsl(0,100%,50%)", "-depth", "8", "rgba:-"], hex: "ff0000ff" },
        { args: ["canvas:hsla(180,50%,50%,0.5)", "-depth", "8", "rgba:-"], hex: "40bfbf80" },
    ])(`${mode}: $args`, async ({ args, hex }) => {
        const fs = new MemoryFileSystem();
        const stdout: number[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(...bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
        if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout.push(...result.stdoutBytes);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(Buffer.from(stdout).toString("hex")).toBe(hex);
    });
}
