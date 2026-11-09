import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: PNG32 output decoded to RGBA8.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6NDk6NDgrMDA6MDCW3M+vAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjQ5OjQ4KzAwOjAw54F3EwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzo0OTo0OCswMDowMLCUVswAAAETSURBVBjTAQgB9/4AJXjLHo7hNIf3Sp3wYLMGWckcb8Iyhdgrm+5BlARXqv0AbcATZtYpfM8/kuU4qPtOoRFktwp6zSBz4zaJ3Eyf8kUAtQhbrh5xxBeH2i2A8EOW6Vms/1LCFWi7K37RJJTnOo0A/VCj9ma5DF/PInXIOIveMaH0R5oKXbADc8YZbNwvgtUARZjrPq4BVKcXar0QgNMmeek8j+JSpfhLuw5htCR3yh0AjeAzhvZJnO9fsgVYyBtuwTGE1yqa7UCTA1ap/Gy/EmUA1Sh7zj6R5Den+k2gEGO2CXnMH3LiNYjbS57xRLQHWq0AHXDDFobZLH/vQpXoWKv+UcEUZ7oqfdAjk+Y5jPxPovUcJoEBTbp3hAAAAABJRU5ErkJggg==", "base64");

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { channels: [], first: [128, 170, 255, 51], hash: "07ff64a510ba60ab59d0eb0bbcca66eca3cb6fe2b479263dad8cd6c3a60221b2" },
        { channels: ["-channel", "Default"], first: [128, 170, 255, 51], hash: "07ff64a510ba60ab59d0eb0bbcca66eca3cb6fe2b479263dad8cd6c3a60221b2" },
        { channels: ["-channel", "A"], first: [37, 120, 203, 128], hash: "90144242063dedb64635674e421ceea39ae4ba45ccfc16b1315a8bac080ca0e7" },
        { channels: ["-channel", "RGB"], first: [128, 170, 255, 30], hash: "798666f3398696b7e4e496809a38d830481178af621c3e2d45b0ac62e1864443" },
        { channels: ["-channel", "A", "+channel"], first: [128, 170, 255, 51], hash: "07ff64a510ba60ab59d0eb0bbcca66eca3cb6fe2b479263dad8cd6c3a60221b2" },
    ])(`${mode}: matches native ordered-dither channels $channels`, async ({ channels, first, hash }) => {
        const argv = ["in.png", ...channels, "-ordered-dither", "o4x4,2,3,4,5,6", "+channel", "PNG32:out.png"];
        const files = new Map<string, Uint8Array>([["in.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([8, 8]);
        expect([...output.data.slice(0, 4)]).toEqual(first);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });
}
