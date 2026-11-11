import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";
import fixtures from "./interpolative-resize-fixtures.json" with { type: "json" };

// Native ImageMagick Q16-HDRI: input.png <args> PNG24:out.png.
// Identical 5x3 RGB inputs with and without a 12x9+3+2 virtual canvas.
for (const mode of ["command", "retained", "buffered", "sync", "mogrify"] as const) {
    it.each(fixtures)(`${mode}: matches native $name resize with $method`, async fixture => {
        const input = Buffer.from(fixture.input, "base64"), files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...fixture.args, "/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "mogrify" ? await runMogrifyCli([...fixture.args, "/input.png"], { filesystem, cwd: "/" }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const actual = decodeImage(mode === "mogrify" ? await filesystem.readFile("/input.png") : mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const expected = decodeImage(Buffer.from(fixture.output, "base64"));
        expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
        expect(actual.data).toEqual(expected.data);
        expect(actual.virtualCanvas).toEqual(expected.virtualCanvas);
    });
}

for (const retained of [false, true]) {
    it.each([[], ["bogus"], ["8x5!", "-interpolative-resize", "bogus"]])(`preserves output on invalid resize, retained=${retained}, %j`, async (...options) => {
        const input = Buffer.from(fixtures[0]!.input, "base64"), existing = Buffer.from("existing output");
        const files = new Map([["/input.png", input], ["/out.png", existing]]), filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const result = await runConvertCli(["/input.png", "-interpolative-resize", ...options, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(Buffer.from(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!)).toEqual(existing);
    });
    it.each(["5x3!", "100%", "8x5>"])(`keeps pixels and page for unchanged geometry %s, retained=${retained}`, async geometry => {
        const input = Buffer.from(fixtures[0]!.input, "base64"), files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const result = await runConvertCli(["/input.png", "-interpolative-resize", geometry, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const actual = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!), expected = decodeImage(input);
        expect(actual.data).toEqual(expected.data);
        expect(actual.virtualCanvas).toEqual(expected.virtualCanvas);
    });
}
