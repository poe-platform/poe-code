import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const colors = ["#a1256650", "#174476f0", "#7bc8b012", "#e5649633", "#1243ac99"];
// ImageMagick 7.1.2-35 Q16-HDRI reference masks, including alpha.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const outputKind of ["pixels", "colorspace", "threshold"] as const) {
        it.each([
            ["HSL", "Otsu", "ffffffffffffffffffffffffffffffffffffffff"],
            ["Lab", "Kapur", "ffffffff0000000000000000ffffffffffffffff"],
            ["HSL", "Triangle", "ffffffffffffffff00000000ffffffffffffffff"],
            ["sRGB", "Otsu", "ffffffff00000000ffffffffffffffff00000000"],
            ["HSL", "", "a1256650174476f07bc8b012e56496331243ac99"],
            ["Lab", "", "a1256650174476f07bc8b012e56496331243ac99"],
        ].filter(([space, method]) => outputKind === "pixels" || (outputKind === "colorspace" ? !!method : space === "HSL" && method === "Otsu")))(`${mode}: %s %s ${outputKind}`, async (space, method, pixels) => {
            const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", files.get("/out")!);
            const argv = [...colors.map(color => `xc:${color}`), "+append", "-colorspace", space,
                ...(method ? ["-auto-threshold", method] : []),
                ...(outputKind === "pixels" ? ["-colorspace", "sRGB", "-depth", "8", "rgba:/out"]
                    : ["-format", outputKind === "colorspace" ? "%r" : "%[auto-threshold:threshold]", "info:/out"])];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
            expect(result.exitCode, stderr).toBe(0);
            expect(stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(outputKind === "pixels" ? Buffer.from(output).toString("hex") : new TextDecoder().decode(output))
                .toBe(outputKind === "pixels" ? pixels : outputKind === "colorspace" ? "DirectClass sRGB Alpha" : "43.5294%");
        });
    }
}
