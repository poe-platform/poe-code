import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

const bytes = new TextEncoder().encode("P3\n2 1\n255\n40 80 120 160 200 240\n");

for (const mode of ["sync", "memory", "retained", "compare", "magick"] as const) {
    it(`reports each compare operand on stdout only with -identify (${mode})`, async () => {
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/a.ppm", bytes);
        const files = new Map([["a.ppm", bytes]]);
        for (const identify of [false, true]) {
            const argv = ["-metric", "RMSE", ...(identify ? ["-identify"] : []), "a.ppm", "a.ppm", "null:"];
            let result;
            if (mode === "sync") result = runCompareCliSync(argv, files);
            else if (mode === "memory" || mode === "retained") result = await runCompareCli(argv, mode === "memory" ? files : { filesystem, cwd: "/" });
            else {
                const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
                const args = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...argv]);
                let stdout = "", stderr = "";
                const status = await command.execute({ command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } });
                result = { ...status, stdout, stderr };
            }
            expect(result.exitCode).toBe(0);
            expect(result.stderr).toBe("0 (0)");
            if (identify) {
                const lines = result.stdout.trimEnd().split("\n");
                expect(lines).toHaveLength(2);
                for (const line of lines) expect(line.startsWith("a.ppm[0] PPM 2x1 2x1+0+0 8-bit sRGB 33B ")).toBe(true);
            } else expect(result.stdout).toBe("");
        }
    });
}
