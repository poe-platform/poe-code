import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// PNG input and decoded RGBA8 reference hashes from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6NDk6NDgrMDA6MDCW3M+vAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjQ5OjQ4KzAwOjAw54F3EwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzo0OTo0OCswMDowMLCUVswAAAETSURBVBjTAQgB9/4AJXjLHo7hNIf3Sp3wYLMGWckcb8Iyhdgrm+5BlARXqv0AbcATZtYpfM8/kuU4qPtOoRFktwp6zSBz4zaJ3Eyf8kUAtQhbrh5xxBeH2i2A8EOW6Vms/1LCFWi7K37RJJTnOo0A/VCj9ma5DF/PInXIOIveMaH0R5oKXbADc8YZbNwvgtUARZjrPq4BVKcXar0QgNMmeek8j+JSpfhLuw5htCR3yh0AjeAzhvZJnO9fsgVYyBtuwTGE1yqa7UCTA1ap/Gy/EmUA1Sh7zj6R5Den+k2gEGO2CXnMH3LiNYjbS57xRLQHWq0AHXDDFobZLH/vQpXoWKv+UcEUZ7oqfdAjk+Y5jPxPovUcJoEBTbp3hAAAAABJRU5ErkJggg==", "base64");
const cases: [string[], string][] = [
    [["-ordered-dither", "o4x4,%[fx:w/2]"], "227c6d09b47b352b9676ef57739edc869ccc5733e546c0f91c2e20f5cec83145"],
    [["-set", "option:matrix", "checks", "-ordered-dither", "%[option:matrix],3"], "b4e75fd55594315106e75a1c98a4a8ecb9c98be691841b961a3b7f87b54881cc"],
    [["-set", "matrix", "o4x4", "-ordered-dither", "%[matrix],%[fx:w/2]"], "227c6d09b47b352b9676ef57739edc869ccc5733e546c0f91c2e20f5cec83145"],
    [["(", "+clone", "-crop", "4x8+0+0", "+repage", ")", "-ordered-dither", "o4x4,%[fx:w/2]", "+append"], "b1568115d1dac055fe9da8deb401e1f349a565ab718471f51fbead715e2c94bd"]
];

for (const mode of ["public", "memory", "sync"] as const) {
    it.each(cases)(`${mode}: expands ordered-dither properties in %j`, async (operation, expected) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const files = new Map<string, Uint8Array>([["/input.png", input]]);
        const args = ["/input.png", ...operation, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode, stderr).toBe(0);
        const output = mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect(createHash("sha256").update(decodeImage(output).data).digest("hex")).toBe(expected);
    });
}
