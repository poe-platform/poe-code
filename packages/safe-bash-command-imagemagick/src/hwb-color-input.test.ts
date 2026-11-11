import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI raw samples, including its percentage scaling
// and unnormalized whiteness + blackness above 100%.
const canvases = [
    ["hwb(0,0%,0%)", "ff0000ff", "ffff00000000ffff"],
    ["hwb(60,0%,0%)", "ffff00ff", "ffffffff0000ffff"],
    ["hwb(120,0%,0%)", "00ff00ff", "0000ffff0000ffff"],
    ["hwb(180,20%,30%)", "33b3b3ff", "3333b333b333ffff"],
    ["hwb(240,0,0)", "0000ffff", "00000000ffffffff"],
    ["hwb(300,0%,0%)", "ff00ffff", "ffff0000ffffffff"],
    ["hwb(-120,0%,0%)", "0000ffff", "00000000ffffffff"],
    ["hwb(480,0%,0%)", "00ff00ff", "0000ffff0000ffff"],
    ["hwb(180,20,30)", "14e1e1ff", "1414e1e1e1e1ffff"],
    ["hwb(50%,20%,30%)", "33b343ff", "3333b3334333ffff"],
    ["hwb(180,80%,80%)", "cc3333ff", "cccc33333333ffff"],
    ["hwb(180,-20%,30%)", "00b3b3ff", "0000b333b333ffff"],
    ["hwb(180,120%,30%)", "ffb3b3ff", "ffffb333b333ffff"],
    ["hwba(180,20%,30%,0.5)", "33b3b380", "3333b333b3338000"],
    ["HWBA(180 20% 30% 0)", "33b3b300", "3333b333b3330000"],
    ["hwba(180,20%,30%,1)", "33b3b3ff", "3333b333b333ffff"],
    ["hwba(180,20%,30%,50%)", "33b3b3ff", "3333b333b333ffff"],
    ["hwba(180,20%,30%,0.25%)", "33b3b3a3", "3333b333b333a333"],
    ["hwb(180,20%,30%,0.5)", "33b3b3ff", "3333b333b333ffff"],
] as const;

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    const cases: { args: string[]; expected: string }[] = canvases.flatMap(([color, byte, word]) => ["xc", "canvas"].flatMap(prefix => [
        { args: [`${prefix}:${color}`, "-depth", "8", "rgba:-"], expected: byte },
        { args: [`${prefix}:${color}`, "-depth", "16", "-endian", "MSB", "rgba:-"], expected: word },
    ]));
    for (const [color, endpoint, expected] of [
        ["red", "hwb(0,0%,0%)", "ff"],
        ["black", "hwb(0,0%,0%)", "00"],
        ["lime", "hwb(120,0%,0%)", "ff"],
        ["blue", "hwb(-120,0%,0%)", "ff"],
        ["rgba(255,0,0,0.5)", "hwba(0,0%,0%,0.5)", "ff"],
        ["red", "hsl(0,100%,50%)", "ff"],
    ] as const) cases.push({ args: [`xc:${color}`, "-color-threshold", `${endpoint}-${endpoint}`, "-depth", "8", "gray:-"], expected });

    it.each(cases)(`${mode}: $args`, async ({ args, expected }) => {
        const fs = new MemoryFileSystem();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
        if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout.push(result.stdoutBytes);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
    });
}
