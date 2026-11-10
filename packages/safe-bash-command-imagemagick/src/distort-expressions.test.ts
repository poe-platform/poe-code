import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["option identity", ["xc:red", "-set", "option:arg", "0", "-distort", "SRT", "%[option:arg]", "-format", "%wx%h", "info:-"], "1x1"],
        ["literal identity", ["xc:red", "-distort", "SRT", "0", "-format", "%wx%h", "info:-"], "1x1"],
        ...[
            ["option translation", ["-distort", "SRT", "%[option:arg]"], "a090a08090a09090a0708090102030405060"],
            ["FX identity", ["-distort", "SRT", "%[fx:0]"], "1020304050607080908090a09090a0a090a0"],
            ["literal translation", ["-distort", "SRT", "0,0,1,0,1,1"], "a090a08090a09090a0708090102030405060"],
            ["roll control", ["-roll", "+1+1"], "a090a08090a09090a0708090102030405060"],
        ].map(([name, transform, expected]) => [name, [
            "xc:#102030", "xc:#405060", "xc:#708090", "+append", "(", "xc:#8090a0", "xc:#9090a0", "xc:#a090a0", "+append", ")", "-append",
            "-set", "option:arg", "0,0,1,0,1,1", "-filter", "point", "-virtual-pixel", "tile", ...transform as string[], "-depth", "8", "rgb:/out",
        ], expected]),
    ] as [string, string[], string][])(`expands SRT coefficients: %s via ${mode}`, async (_name, args, expected) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        let stdout = "";
        if (mode === "command") {
            let stderr = "";
            const arguments_ = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: arguments_.args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stderr).toBe("");
            stdout = result.stdout;
        }
        if (args.at(-1) === "info:-") expect(stdout).toBe(expected);
        else {
            const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe(expected);
        }
    });
}
