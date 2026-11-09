import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./exr-fixtures.json" with { type: "json" };

// Native ImageMagick exposes opaque alpha even when an EXR has only B, G, R planes.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    for (const input of ["none-half", "alpha", "png"] as const) {
        for (const alpha of [[], ["-alpha", "off"], ["-alpha", "set"]]) {
            it(`${mode}: evaluates ${input} alpha with ${alpha.join(" ") || "implicit alpha"}`, async () => {
                const exr = new Uint8Array(Buffer.from(fixtures[input === "alpha" ? "alpha" : "none-half"], "base64"));
                const source = input === "png" ? encodeImage(decodeImage(exr), { format: "png" }).data : exr;
                const original = decodeImage(source);
                expect(original.hasAlpha).toBe(input === "alpha");
                const files = new Map([["/input", source]]), fs = new MemoryFileSystem();
                await fs.writeFile("/input", source);
                const args = ["/input", ...alpha, "-channel", "A", "-evaluate", "Divide", "2", "+channel", "PNG32:/out.png"];
                const result = mode === "sync" ? runConvertCliSync(args, files)
                    : mode === "command" ? await createMagickCommand().execute({
                        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                        stdin: (async function* () {})(), signal: new AbortController().signal,
                        stdout: { write: async () => {} }, stderr: { write: async () => {} },
                    })
                    : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = decodeImage(mode === "retained" || mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
                const active = alpha[1] === "set" || (alpha[1] !== "off" && input !== "png");
                expect(Array.from(output.data)).toEqual(Array.from(original.data, (value, index) => index % 4 === 3 ? active ? Math.round(value / 2) : 255 : value));
            });
        }
    }
}
