import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference output, before encoding pixels.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    async function run(argv: string[]) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        return "stdout" in result ? result.stdout : Buffer.concat(stdout).toString();
    }

    it.each([
        { method: undefined, add: "0.25", expected: "0/2:2x1+0+0:3:39321;1/2:2x1+0+0:7:39321.25;" },
        ...["RemoveDups", "CompareAny", "CompareOverlay", "OptimizeFrame", "OptimizePlus"].map(method => ({
            method, add: "0.25", fuzz: undefined, expected: "0/2:2x1+0+0:3:39321;1/2:2x1+0+0:7:39321.25;",
        })),
        { method: "RemoveDups", add: "0", expected: "0/1:2x1+0+0:10:39321;" },
        { method: "RemoveDups", add: "300", expected: "0/2:2x1+0+0:3:39321;1/2:2x1+0+0:7:39621;" },
        { method: "CompareAny", add: "0.25", fuzz: "1%", expected: "0/1:2x1+0+0:3:39321;" },
    ])(`${mode} preserves working samples and timing: $method add=$add fuzz=$fuzz`, async ({ method, add, fuzz, expected }) => {
        expect(await run(["-size", "2x1", "xc:#778899", "-set", "delay", "3",
            "(", "+clone", "-channel", "B", "-evaluate", "add", add, "+channel", "-set", "delay", "7", ")",
            ...(fuzz ? ["-fuzz", fuzz] : []), ...(method ? ["-layers", method] : []),
            "-precision", "13", "-format", "%s/%n:%wx%h%O:%T:%[fx:p{0,0}.b*65535];", "info:"])).toBe(expected);
    });
}
