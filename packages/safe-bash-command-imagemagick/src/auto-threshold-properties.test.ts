import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: Kapur gives 25.098%; Otsu gives 26.6667%.
const input = ["xc:#a1256650", "xc:#174476f0", "xc:#7bc8b012", "xc:#e5649633", "xc:#1243ac99", "+append"];
for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    for (const output of ["threshold", "mask"] as const) {
        it.each([
            { property: "option:method", method: "Kapur", value: "Kapur" },
            { property: "option:method", method: "%[option:method]", value: "Kapur" },
            { property: "option:method", method: "%[method]", value: "Kapur" },
            { property: "method", method: "%[method]", value: "Kapur" },
            { property: "option:method", method: "%[method]", value: "" },
        ])(`${mode} ${output}: expands $property=$value through $method`, async ({ property, method, value }) => {
            const original = new TextEncoder().encode("KEEP");
            const files = new Map([["/out", original]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const args = [...input, "-set", property, value, "-auto-threshold", method,
                ...(output === "threshold" ? ["-format", "%[auto-threshold:threshold]", "info:/out"]
                    : ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"])];
            let stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stderr } : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            const bytes = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
            if (value === "Kapur") {
                expect(result.exitCode, result.stderr).toBe(0);
                expect(output === "threshold" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex"))
                    .toBe(output === "threshold" ? "25.098%" : "ffffffff00000000ffffffffffffffffffffffff");
            } else {
                expect(result.exitCode).toBe(1);
                expect(result.stderr).toContain("invalid argument '-auto-threshold'");
                expect(bytes).toEqual(original);
            }
        });
    }
}
