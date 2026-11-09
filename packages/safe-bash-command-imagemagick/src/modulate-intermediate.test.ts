import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./modulate-intermediate-fixtures.json" with { type: "json" };

it("retains the linear RGB label after neutral modulation", () => {
    const files = new Map([["/in.png", Buffer.from(fixtures.input, "base64")]]);
    const result = runConvertCliSync(["/in.png", "-colorspace", "RGB", "-modulate", "100", "-format", "%[colorspace]", "info:"], files);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("RGB");
});

// ImageMagick 7.1.2-31 Q16-HDRI: input PNG -> options -> PNG32 -> depth-8 RGBA.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixtures.cases)(`preserves converted modulation samples via ${mode}: $options`, async ({ options, rgba }) => {
        const input = Buffer.from(fixtures.input, "base64");
        const fs = new MemoryFileSystem(), files = new Map([["/in.png", input]]);
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", ...options, "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual([...Buffer.from(rgba, "base64")]);
    });
}
