import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const operation of [[], ["-flatten"], ["-layers", "flatten"], ["-layers", "merge"], ["-mosaic"], ["-layers", "mosaic"]]) {
        it.each([undefined, "0.8"])(`${mode} ${operation.join(" ") || "no flatten"} preserves gamma %s`, async gamma => {
            const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("/out")!);
            const args = ["xc:#3070b080", ...(gamma ? ["-set", "gamma", gamma] : []), ...operation,
                "-format", "%[colorspace] %x %y %U %[gamma] <%l> <%[custom:key]>", "info:/out"];
            const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
                args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async () => {} } })
                : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
            expect(new TextDecoder().decode(output)).toBe(`sRGB 72 72 Undefined ${gamma ?? "0.454545"} <> <>`);
        });
    }
}
