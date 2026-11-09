import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, stripped PNG24 fixtures.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAAFUlEQVQI12P4z8DA8J+BgeH///8MABzwBPwa7xcOAAAAAElFTkSuQmCC", "base64");
const mask = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAAD0lEQVQI12P4//8/AwwAACDsAv7qSESjAAAAAElFTkSuQmCC", "base64");
const colors = ["ff0000ff", "00ff00ff", "0000ffff", "ffff00ff"];
const doubled = colors.flatMap(color => [color, color]).join("");
const attach = ["-write-mask", "/mask.png"];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "enlarged", ops: [...attach, "-sample", "8x1!", "+write-mask"], expected: "000000ff".repeat(8) },
        { name: "reduced", ops: [...attach, "-sample", "2x1!", "+write-mask"], expected: "000000ff".repeat(2) },
        { name: "same size", ops: [...attach, "-sample", "4x1!", "+write-mask"], expected: colors.join("") },
        { name: "unmasked", ops: ["-sample", "8x1!"], expected: doubled },
        { name: "cleared mask", ops: [...attach, "+write-mask", "-sample", "8x1!"], expected: doubled },
        { name: "point resize", ops: [...attach, "-filter", "point", "-resize", "8x1!", "+write-mask"], expected: doubled },
        { name: "black mask", ops: ["-write-mask", "xc:black", "-sample", "8x1!", "+write-mask"], expected: "000000ff".repeat(8) },
        { name: "white mask", ops: ["-write-mask", "xc:white", "-sample", "8x1!", "+write-mask"], expected: "000000ff".repeat(8) },
        { name: "active alpha", ops: ["-alpha", "on", ...attach, "-sample", "8x1!", "+write-mask"], expected: "00000000".repeat(8) },
        { name: "later edit", ops: [...attach, "-sample", "8x1!", "-negate", "+write-mask"], expected: "ffffffff".repeat(8) },
    ])(`${mode}: masked sample matches native for $name`, async ({ ops, expected }) => {
        const files = new Map([["/input.png", input], ["/mask.png", mask]]), filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/input.png", ...ops, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([expected.length / 8, 1]);
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });
}

for (const retained of [false, true]) {
    it(`preserves masked sample depth across pixel chunks (retained=${retained})`, async () => {
        const source = decodeImage(input);
        const bytes = encodeImage({ ...source, data16: Uint16Array.from(source.data, value => value * 257) }, { format: "png" }).data;
        const files = new Map([["/input.png", bytes], ["/mask.png", mask]]), filesystem = new MemoryFileSystem();
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const result = await runConvertCli(["/input.png", ...attach, "-sample", "2051x2!", "+write-mask", "-depth", "16", "PNG48:/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([2051, 2]);
        expect(output.data16).toEqual(Uint16Array.from({ length: 2051 * 2 * 4 }, (_, i) => i % 4 === 3 ? 65535 : 0));
    });
}
