import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: empty trim replaces every channel with
// the transparent background before conversion out of the working colorspace.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const format of ["rgba", "info"] as const) {
        it.each([
            { space: "HSL", trim: true, hex: "ffffff00" },
            { space: "HSB", trim: true, hex: "ff000000" },
            { space: "Lab", trim: true, hex: "ff5a0000" },
            { space: "sRGB", trim: true, hex: "ffffff00" },
            { space: "CMYK", trim: true, hex: "ffffff00" },
            { space: "HSL", trim: false, hex: "803820ff".repeat(6) },
            { space: "HSB", trim: false, hex: "803820ff".repeat(6) },
            { space: "Lab", trim: false, hex: "803820ff".repeat(6) },
        ])(`${mode} ${format}: preserves trim pixels leaving $space (trim=$trim)`, async ({ space, trim, hex }) => {
            const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("/out")!);
            const argv = ["-size", "3x2", "xc:#803820", "-colorspace", space, ...(trim ? ["-trim"] : []),
                ...(format === "rgba" ? ["-colorspace", "sRGB", "-depth", "8"] : ["-format", "%wx%h|%g"]), `${format}:/out`];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe(trim ? "magick: geometry does not contain image '#803820'\n" : "");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            if (format === "rgba") expect(Buffer.from(output).toString("hex")).toBe(hex);
            else expect(new TextDecoder().decode(output)).toBe(trim ? "1x1|3x2-1-1" : "3x2|3x2+0+0");
        });
    }
}
