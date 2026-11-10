import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI PNG32 output, decoded with -depth 8 rgba:-.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMTBUMDE6Mjc6MDYrMDA6MDBPuAIoAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTEwVDAxOjI3OjA2KzAwOjAwPuW6lAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0xMFQwMToyNzowNiswMDowMGnwm0sAAAAfSURBVAjXYxZ0yG89eufLfmWrS7WMEga7mT6gAQwBADcVJVHR3/hOAAAAAElFTkSuQmCC", "base64");
const cases = [
    { name: "regional", options: ["-region", "2x2+1+0"], expected: Buffer.from("09295085e1ff020083c4ff734474a3f900183c75cbff00ff6daeef5d326293e9910d2965aedf0ae136526f5d1f5081d9", "hex") },
    { name: "unmasked", options: [], expected: Buffer.from("001f607ee1ff020083c4ff732667a7ff00094a68cbff00ff6daeef5d105191ffff003452b5f500fc5798d947003b7bf1", "hex") },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) for (const operation of [["-normalize"], ["-contrast-stretch", "2%x1%"]]) {
    it.each(cases)(`matches every native ${operation.join(" ")} pixel with translucent input: $name (${mode})`, async ({ options, expected }) => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", ...options, ...operation, "+region", "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([4, 3]);
        expect([...output.data]).toEqual([...expected]);
    });
}
