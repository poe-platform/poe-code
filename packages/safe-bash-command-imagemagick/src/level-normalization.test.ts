import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const operator of ["-level", "+level"] as const) {
    for (const mode of ["buffered", "sync", "command"] as const) {
        it.each(["10x80%", "(10x80%)", "1 0x8 0%"])(`${operator} normalizes %s via ${mode}`, async (endpoints) => {
            const input = new TextEncoder().encode("P3\n3 1\n255\n15 80 145 17 152 231 195 208 65\n");
            const files = new Map([["/a.ppm", input], ["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argv = ["/a.ppm", operator, endpoints, "-endian", "MSB", "-depth", "16", "rgb:/out"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            // Native ImageMagick 7.1.2-35 Q16-HDRI output for all three spellings.
            expect(Buffer.from(output).toString("hex")).toBe(operator === "-level"
                ? "00004e29ab620000b56cfffff317ffff38a6"
                : "242451d27f7f258c846abbeea2a2abc54747");
        });
    }
}
