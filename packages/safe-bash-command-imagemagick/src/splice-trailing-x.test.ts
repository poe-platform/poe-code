import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: a trailing x field leaves the vertical offset at zero.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const format of ["rgb", "info"] as const) {
        it.each(["1x1+1x2", "1x1+1x1+1", "1x1+1+0", "1x1+0x1", "1x1+1e+0X2"])(`preserves the splice rectangle before a trailing x: %s (${mode}, ${format})`, async geometry => {
            const input = Uint8Array.from([...new TextEncoder().encode("P6\n6 5\n255\n"),
                ...Array.from({ length: 90 }, (_, i) => i)]);
            const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const argv = ["/in.ppm", "-background", "red", "-repage", "4x3+1+1", "-gravity", "Center",
                "-splice", geometry, "-depth", "8", "-format", "%wx%h %g", `${format}:/out`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            if (format === "info") {
                expect(new TextDecoder().decode(output)).toBe("7x6 5x4+1+1");
            } else {
                expect(output.length).toBe(126);
                expect(createHash("sha256").update(output).digest("hex")).toBe("35dda342544e40c0857415954bfe821969feb6d50f5c297851624aca226cfa7d");
            }
        });
    }
}
