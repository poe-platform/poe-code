import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI PNG32 round trips, decoded with -depth 8 rgba:-.
import fixtures from "./unique-colors-cmyk-fixtures.json" with { type: "json" };
for (const fixture of fixtures) for (const mode of ["sync", "map", "retained", "command"]) for (const repeat of [false, true]) {
    it(`extracts ${fixture.name} CMYK palette in native order (${mode}, repeated=${repeat})`, async () => {
        const bytes = Buffer.from(fixture.input, "base64");
        const files = new Map([["/in.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", bytes);
        const args = ["/in.png", "-colorspace", "CMYK", "-unique-colors", ...(repeat ? ["-unique-colors"] : []), "-colorspace", "sRGB", "PNG32:/out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
        }
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([12, 1]);
        expect(Buffer.from(output.data).toString("hex")).toBe(fixture.expected);
    });
}
