import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import references from "./fixtures/rotate-scale.json" with { type: "json" };

// Native ImageMagick 7.1.2-31 Q16-HDRI, PNG32 output decoded to 8-bit RGBA.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(references.cases)(`matches native rotation scale: $name (${mode})`, async ({ options, angle, geometry, rgba }) => {
        const input = Buffer.from(references.input, "base64");
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...options, "-rotate", angle, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        const page = output.virtualCanvas ?? { width: output.width, height: output.height, x: 0, y: 0 };
        expect([output.width, output.height, page.width, page.height, page.x, page.y]).toEqual(geometry);
        expect(output.data).toEqual(new Uint8Array(Buffer.from(rgba, "base64")));
    });
}
