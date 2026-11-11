import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Dimensions and failures verified with ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-sample", "-resize", "-scale", "-thumbnail", "-adaptive-resize"]) {
        it.each([
            { size: "200x100", geometry: "100:100%", expected: "1x1" },
            { size: "200x100", geometry: "2:1%", expected: "2x1" },
            { size: "101x149", geometry: "3:2%", expected: "2x1" },
            { size: "100x200", geometry: "1:2%", expected: "1x2" },
            { size: "7x5", geometry: "3:2%", expected: undefined },
            { size: "20x200", geometry: "1:1%", expected: undefined },
            { size: "500x100", geometry: "1:5%", expected: undefined },
            { size: "200x100", geometry: "100:100", expected: "100x100" },
        ])(`${mode}: ${option} $geometry on $size`, async ({ size, geometry, expected }) => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", original]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/out", original);
            const args = ["-size", size, "xc:#ff0000", option, geometry, "-format", "%wx%h", "info:/out"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const diagnostic = "stderr" in result ? result.stderr : stderr;
            expect(result.exitCode, diagnostic).toBe(expected === undefined ? 1 : 0);
            const output = mode === "command" || mode === "retained"
                ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(expected ?? "KEEP");
            if (expected === undefined) expect(diagnostic).toContain("negative or zero image size");
        });
    }
}
