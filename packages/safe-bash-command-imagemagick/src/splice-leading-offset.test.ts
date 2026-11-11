import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a leading signed number is an offset, not a band width.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const format of ["rgb", "info"] as const) {
        it.each([
            ["-1", "52fdc66cf0a4c6a8292b20b96d14ac52e7454c9e79333e1a0781cd3114274e69"],
            ["+1", "7dc6b33919b725155ce2e5a4aaa836fb1d745ea7a2b189aeb012fceb01c04320"],
        ])(`uses page dimensions for a leading splice offset: %s (${mode}, ${format})`, async (offset, hash) => {
            const outputs: Uint8Array[] = [];
            for (const geometry of [`${offset}x1`, `4x3${offset}+0`]) {
                const input = Buffer.concat([Buffer.from("P6\n6 5\n255\n"), Uint8Array.from({ length: 90 }, (_, i) => i)]);
                const files = new Map<string, Uint8Array>([["/in.ppm", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.ppm", input);
                const argv = ["/in.ppm", "-background", "red", "-repage", "4x3+1+1", "-gravity", "Center",
                    "-splice", geometry, "-depth", "8", "-format", "%wx%h %g", `${format}:${mode === "command" ? "-" : "/out"}`];
                const args = createCommandArguments(argv);
                let stderr = "";
                const stdout: Uint8Array[] = [];
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
                    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
                }) : mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
                outputs.push(mode === "command" ? Buffer.concat(stdout) : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!);
            }
            expect(outputs[0]).toEqual(outputs[1]);
            if (format === "info") {
                expect(new TextDecoder().decode(outputs[0])).toBe("10x8 7x5+2+2");
            } else {
                expect(outputs[0]).toHaveLength(240);
                expect(createHash("sha256").update(outputs[0]!).digest("hex")).toBe(hash);
            }
        });
    }
}
