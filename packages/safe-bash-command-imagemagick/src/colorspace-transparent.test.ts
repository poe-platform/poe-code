import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: Transparent preserves pixels and alpha traits.
const cases = [
    { name: "RGBA bytes", input: ["xc:#c0402080"], args: ["-depth", "8", "rgba:out"], expected: Buffer.from("c0402080", "hex") },
    { name: "alpha metadata", input: ["xc:#c0402080"], args: ["-format", "%[colorspace]|%[channels]", "info:out"], expected: Buffer.from("sRGB|srgba 4.0") },
    { name: "opaque metadata", input: ["xc:#c04020"], args: ["-format", "%[colorspace]|%[channels]", "info:out"], expected: Buffer.from("sRGB|srgb  3.0") },
    ...["RGB", "HSL", "Gray"].map(space => ({
        name: `${space} conversion`, input: ["xc:#c0402080", "-colorspace", space],
        args: ["-format", "%[colorspace]|%[channels]", "info:out"],
        expected: Buffer.from("sRGB|srgba 4.0"),
    })),
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const space of [undefined, "Transparent", "tRaNsPaReNt"]) {
        it.each(cases)(`${mode}: ${space ?? "control"} $name matches native output`, async ({ input, args, expected }) => {
            const argv = [...input, ...(space ? ["-colorspace", space] : []), ...args];
            const files = new Map<string, Uint8Array>([["out", Buffer.from("KEEP")]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/out", Buffer.from("KEEP"));
            let stderr = "";
            const parsed = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: parsed.args, argumentValues: parsed, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} },
                stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            if ("stderr" in result) stderr = String(result.stderr);
            expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
            expect(Buffer.from(output)).toEqual(!space && input.length > 1
                ? Buffer.from(`${input[2]}|${input[2] === "Gray" ? "graya 2.0" : input[2] === "RGB" ? "rgba 4.0" : "hsla 4.0"}`) : expected);
        });
    }
}
