import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["%[fx:w/4]x1", "2x1"],
        ["%[fx:w/4]x%[fx:h/8]", "2x1"],
    ])(`expands Kuwahara %s before filtering via ${mode}`, async (expression, literal) => {
        const input = new Uint8Array(await readFile(new URL("./fixtures/kuwahara-expression-input.png", import.meta.url)));
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        for (const [value, path] of [[literal, "/literal.png"], [expression, "/expression.png"]]) {
            const args = ["/input.png", "-kuwahara", value!, `PNG32:${path}`];
            if (mode === "command") {
                const arguments_ = createCommandArguments(args);
                let stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: arguments_.args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write(chunk) { stderr += chunk; } },
                });
                expect(result.exitCode, stderr).toBe(0);
                continue;
            }
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        }
        const literalImage = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/literal.png") : files.get("/literal.png")!);
        const expressionImage = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/expression.png") : files.get("/expression.png")!);
        expect([expressionImage.width, expressionImage.height]).toEqual([8, 8]);
        expect(expressionImage.data).toEqual(literalImage.data);
    });
}
