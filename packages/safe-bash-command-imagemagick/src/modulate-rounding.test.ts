import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./modulate-rounding-fixtures.json";

// ImageMagick 7.1.2-35 Q16-HDRI: rgba.png -modulate VALUE PNG32:out.png,
// then out.png -depth 8 rgba:-. The 16x16 ramp includes RGB half-step samples.
for (const mode of ["buffered", "sync", "command"] as const) {
    it.each(fixtures.samples)(`matches native HSL byte rounding for $value via ${mode}`, async ({ value, rgba }) => {
        const input = Uint8Array.from(Buffer.from(fixtures.input, "base64"));
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", "-modulate", value, "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
            argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
            : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(output.width).toBe(16);
        expect(output.height).toBe(16);
        expect(output.data).toEqual(Uint8Array.from(Buffer.from(rgba, "base64")));
    });
}
