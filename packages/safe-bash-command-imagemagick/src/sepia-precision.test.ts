import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixture from "./sepia-precision-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: input.png ...args PNG32:out.png,
// decoded with out.png -depth 8 rgba:-, without saving intermediate operations.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixture.cases)(`preserves sepia working precision through $name (${mode})`, async ({ args, rgba }) => {
        const input = Buffer.from(fixture.input, "base64");
        const files = new Map<string, Uint8Array>([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["in.png", ...args, "PNG32:out.png"];
        const arguments_ = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(rgba);
    });
}

it.each(fixture.cases.filter(({ name }) => name === "second tone" || name === "HSL"))(
    "retains sepia precision across histogram and pixel chunks: $name", async ({ args, rgba }) => {
        const image = decodeImage(Buffer.from(fixture.input, "base64"));
        const repeats = 80;
        const data = Uint8Array.from({ length: image.data.length * repeats }, (_, i) => image.data[i % image.data.length]!);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", encodeImage({ ...image, height: image.height * repeats, data }, { format: "png" }).data);
        const result = await runConvertCli(["in.png", ...args, "PNG32:out.png"], { filesystem: fs, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(Buffer.from(decodeImage(await fs.readFile("/out.png")).data).toString("hex")).toBe(rgba.repeat(repeats));
    }
);
