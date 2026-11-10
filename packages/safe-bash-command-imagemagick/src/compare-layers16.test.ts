import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    async function run(argv: string[]) {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        if (argv.at(-1) === "rgba:-") {
            const bytes = "stdoutBytes" in result ? result.stdoutBytes : Buffer.concat(stdout);
            expect(bytes).toBeInstanceOf(Uint8Array);
            return Buffer.from(bytes as Uint8Array).toString("hex");
        }
        return "stdout" in result ? result.stdout : Buffer.concat(stdout).toString();
    }

    it(`${mode} preserves exact 16-bit samples in the surviving crop`, async () => {
        const frames = ["-size", "2x1", "xc:#2345567889ab", "(", "-size", "1x1",
            "xc:#2345567889ab", "xc:#2346567889ab", "+append", ")"];
        const output = ["-depth", "16", "-endian", "MSB", "rgba:-"];
        expect(await run([...frames, ...output])).toBe("2345567889abffff".repeat(3) + "2346567889abffff");
        for (const method of ["CompareAny", "CompareOverlay"])
            expect(await run([...frames, "-layers", method, ...output])).toBe("2345567889abffff".repeat(2) + "2346567889abffff");
    });

    for (const operation of [["-layers", "CompareAny"], ["-layers", "CompareOverlay"], ["-deconstruct"]]) {
        it.each([
            { name: "red quantum", color: "2346567889ab", changed: true },
            { name: "green quantum", color: "2345567989ab", changed: true },
            { name: "blue quantum", color: "2345567889ac", changed: true },
            { name: "explicit zero fuzz", color: "2346567889ab", fuzz: "0%", changed: true },
            { name: "nonzero fuzz", color: "2346567889ab", fuzz: "0.01%", changed: false },
            { name: "equality", color: "2345567889ab", changed: false },
            { name: "large change", color: "aaab567889ab", changed: true },
        ])(`${mode} ${operation.join(" ")} detects $name`, async ({ color, fuzz, changed }) => {
            expect(await run(["-size", "2x1", "xc:#2345567889ab", "(", "-size", "1x1",
                "xc:#2345567889ab", `xc:#${color}`, "+append", ")", ...(fuzz ? ["-fuzz", fuzz] : []),
                ...operation, "-format", "%wx%h%O;", "info:"]))
                .toBe(changed ? "2x1+0+0;1x1+1+0;" : "2x1+0+0;");
        });
    }

    it.each([
        { first: "2345567889ab", second: "2346567889ab", changed: true },
        { first: "2345567889ab1000", second: "2345567889ab1001", changed: true },
        { first: "ff0000", second: "ff0000", changed: false },
        { first: "2345567889ab", second: "2345567889ab", changed: false },
    ])(`${mode} RemoveDups preserves 16-bit changes and timing: $first -> $second`, async ({ first, second, changed }) => {
        expect(await run(["-delay", "3", `xc:#${first}`, "-delay", "5", `xc:#${second}`,
            "-delay", "7", "xc:blue", "-layers", "RemoveDups", "-format", "%wx%h%O:%T;", "info:"]))
            .toBe(changed ? "1x1+0+0:3;1x1+0+0:5;1x1+0+0:7;" : "1x1+0+0:8;1x1+0+0:7;");
    });
}
