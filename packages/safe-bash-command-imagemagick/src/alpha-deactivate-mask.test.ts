import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI keeps all three pixels opaque.
for (const mode of ["command", "buffered", "sync"] as const) {
    for (const depth of [8, 16]) {
        it.each([
            { selection: ["-region", "1x1+1+0"], clear: [] },
            { selection: ["-write-mask", "/mask.pgm"], clear: [] },
            { selection: ["-region", "1x1+1+0"], clear: ["+region"] },
            { selection: ["-write-mask", "/mask.pgm"], clear: ["+write-mask"] },
            { selection: [], clear: [] },
        ])(`${mode}: deactivated alpha stays opaque at depth ${depth} with %j`, async ({ selection, clear }) => {
            const files = new Map<string, Uint8Array>([
                ["/mask.pgm", Buffer.concat([Buffer.from("P5\n3 1\n255\n"), Buffer.from([0, 255, 255])])],
                ["/out", Buffer.from("KEEP")],
            ]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argv = ["-size", "3x1", "xc:#804020ff", ...selection, "-alpha", "Deactivate", ...clear, "-depth", String(depth), "-endian", "MSB", "rgba:/out"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            expect(Buffer.from(output).toString("hex")).toBe((depth === 8 ? "804020ff" : "808040402020ffff").repeat(3));
        });
    }
}
