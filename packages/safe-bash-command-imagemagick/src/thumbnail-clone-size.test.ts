import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from([10, 20, 30, 90, 110, 130])]);

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { operation: [], sizes: [17] },
        { operation: ["-duplicate", "2"], sizes: [17, 0, 0] },
        { operation: ["+duplicate"], sizes: [17, 0] },
        { operation: ["+clone"], sizes: [17, 0] },
        { operation: ["-clone", "0,0"], sizes: [17, 0, 0] },
        { operation: ["(", "+clone", ")"], sizes: [17, 0] },
        { operation: ["(", "-clone", "0", ")"], sizes: [17, 0] },
        { operation: ["(", "+clone", "-thumbnail", "4x3", ")"], sizes: [17, 0] },
        { operation: ["-duplicate", "1", "in.ppm"], sizes: [17, 0, 17] }
    ])(`keeps the original thumbnail size and detaches clones after $operation (${mode})`, async ({ operation, sizes }) => {
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        const files = new Map([["in.ppm", input]]);
        const args = ["in.ppm", ...operation, "-thumbnail", "4x3", "-format", "%p:%[Thumb::Size]:%B;", "info:"];
        let stdout = "";
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write(chunk) { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } } });
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
            expect(result.stderr).toBe("");
            stdout = result.stdout;
        }
        expect(stdout).toBe(sizes.map((size, index) => `${index}:${size}:17;`).join(""));
    });
}
