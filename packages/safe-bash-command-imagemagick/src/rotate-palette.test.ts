import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./rotate-palette-fixtures.json" with { type: "json" };

// Native Q16-HDRI: input -rotate angle -channel R -solarize 40% PNG32:output.png.
// Indexed and direct inputs contain identical pixels; only storage class differs.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(fixtures.cases)(`${mode}: rotates $input by $angle with native storage and solarize behavior`, async fixture => {
        const input = Buffer.from(fixtures.inputs[fixture.input as keyof typeof fixtures.inputs], "base64");
        const files = new Map<string, Uint8Array>([["/in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-rotate", fixture.angle, "-write", "PNG32:/before.png", "-channel", "R", "-solarize", "40%", "-write", "PNG32:/after.png", "-format", "%r|%wx%h|%g", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if ("stdout" in result && typeof result.stdout === "string") stdout = result.stdout;
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        for (const stage of ["before", "after"] as const) {
            const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile(`/${stage}.png`) : files.get(`/${stage}.png`)!;
            const image = decodeImage(bytes);
            expect([image.width, image.height]).toEqual(fixture.dimensions);
            expect(Buffer.from(image.data).toString("base64"), stage).toBe(fixture[stage]);
        }
        const [storage, dimensions, page] = stdout.trimEnd().split("|");
        expect(storage).toContain(fixture.storage);
        expect(dimensions).toBe(fixture.dimensions.join("x"));
        expect(page).toBe(fixture.page);
    });
}
