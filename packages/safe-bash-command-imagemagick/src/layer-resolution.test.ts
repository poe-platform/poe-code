import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const operation of [[], ["-flatten"], ["-layers", "flatten"], ["-layers", "merge"], ["-mosaic"], ["-layers", "mosaic"]])
for (const raw of [false, true]) {
    it(`${mode} ${operation.join(" ") || "control"} retains resolution and pixels (raw: ${raw})`, async () => {
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("out")!);
        const args = ["xc:#3070b080", "-units", "PixelsPerInch", "-density", "123x87", ...operation,
            ...(raw ? ["-colorspace", "sRGB", "-depth", "8", "rgba:out"]
                : ["-format", "%[colorspace] %x %y %U %[gamma] <%l> <%[custom:key]>", "info:out"])];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("out")!;
        // Native ImageMagick 7.1.2-35: composited RGBA8 and effective resolution.
        if (raw) expect(Array.from(output)).toEqual(operation.length ? [151, 183, 215, 255] : [48, 112, 176, 128]);
        else expect(new TextDecoder().decode(output)).toBe("sRGB 123 87 PixelsPerInch 0.454545 <> <>");
    });
}
