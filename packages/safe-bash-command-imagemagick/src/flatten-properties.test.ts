import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const operation of [[], ["-flatten"], ["-layers", "flatten"], ["-layers", "merge"], ["-mosaic"], ["-layers", "mosaic"]]) {
        const cases = [
            { input: ["xc:#3070b080", "-set", "label", "primary"], format: "%[colorspace] %x %y %U %[gamma] <%l> <%[custom:key]>", expected: "sRGB 72 72 Undefined 0.454545 <primary> <>" },
            { input: ["xc:#3070b080", "-set", "custom:key", "hello"], format: "%[colorspace] %x %y %U %[gamma] <%l> <%[custom:key]>", expected: "sRGB 72 72 Undefined 0.454545 <> <hello>" },
            ...(operation.length ? [{ input: ["(", "xc:red", "-set", "label", "bottom", "-set", "note", "first", "-units", "PixelsPerInch", "-density", "123x87", "-set", "gamma", "0.8", ")", "(", "xc:blue", "-set", "label", "top", "-set", "note", "second", "-units", "PixelsPerCentimeter", "-density", "41x37", "-set", "gamma", "0.6", ")"], format: "<%l> <%[note]> %x %y %U %[gamma]", expected: "<bottom> <first> 41 37 PixelsPerCentimeter 0.8" }] : []),
        ];
        it.each(cases)(`${mode} ${operation.join(" ") || "control"} retains metadata: $expected`, async ({ input, format, expected }) => {
            const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("/out")!);
            const args = [...input, ...operation, "-format", format, "info:/out"];
            const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
                args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} } })
                : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(expected);
        });
    }
}
