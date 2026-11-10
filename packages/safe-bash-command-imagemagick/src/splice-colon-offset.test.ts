import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a colon after an offset retains that offset.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const format of ["rgb", "info"] as const) {
        it.each(["1x1+1:1", "1x1+1:2", "1x1+1", "1x1:1"])(`preserves splice offsets before a colon: %s (${mode}, ${format})`, async geometry => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argv = ["xc:#123456", "xc:#8badcf", "xc:#fedcba", "+append", "-background", "red",
                "-splice", geometry, "-depth", "8", "-format", "%wx%h", `${format}:${mode === "command" ? "-" : "/out"}`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const stdout: Uint8Array[] = [];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout.push(chunk.slice()); } }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
            const output = mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            if (format === "info") {
                expect(new TextDecoder().decode(output)).toBe("4x2");
            } else {
                const secondRow = geometry === "1x1:1" ? "ff00001234568badcffedcba" : "123456ff00008badcffedcba";
                expect(Buffer.from(output).toString("hex")).toBe("ff0000".repeat(4) + secondRow);
            }
        });
    }
}
