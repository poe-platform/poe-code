import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI treats decoration colors as ink values.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-border", "-frame"]) {
        it.each([
            { space: "CMYK", convert: false, output: "cmyk", padding: "80502000", center: "996600af" },
            { space: "CMYK", convert: true, output: "rgba", padding: "7fafdfff", center: "203050ff" },
            { space: "CMYK", depth: "16", convert: false, output: "cmyk", padding: "8080505020200000", center: "999966660000afaf" },
            { space: "CMYK", depth: "16", convert: true, output: "rgba", padding: "7f7fafafdfdfffff", center: "202030305050ffff" },
            { space: "sRGB", convert: true, output: "rgba", padding: "805020ff", center: "203050ff" },
        ])(`${mode}: ${operation} preserves $space padding and source pixels ($output, depth=$depth, convert=$convert)`, async ({ space, depth = "8", convert, output, padding, center }) => {
            const argv = ["xc:#203050", "-colorspace", space, "-mattecolor", "#805020", "-bordercolor", "#805020",
                operation, "1x1", ...(convert ? ["-colorspace", "sRGB"] : []), "-depth", depth, "-endian", "MSB", `${output}:-`];
            const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            let bytes: Buffer;
            if (mode === "command") {
                const argumentValues = createCommandArguments(argv), stdout: Buffer[] = [], stderr: Buffer[] = [];
                const result = await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
                    stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
                });
                expect(result.exitCode).toBe(0);
                expect(Buffer.concat(stderr).toString()).toBe("");
                bytes = Buffer.concat(stdout);
            } else {
                const result = mode === "sync" ? runMagickCliSync(argv, files)
                    : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                bytes = Buffer.from(result.stdoutBytes ?? result.stdout);
            }
            expect(bytes.toString("hex")).toBe(padding.repeat(4) + center + padding.repeat(4));
        });
    }
}
