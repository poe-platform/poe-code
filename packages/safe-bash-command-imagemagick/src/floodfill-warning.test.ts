import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["black", "white"])(`${mode}: unrecognized floodfill color warns and succeeds on %s`, async background => {
        const pixel = background === "black" ? [0, 0, 0, 255] : [255, 255, 255, 255];
        const input = encodeImage({ width: 2, height: 2, data: Uint8Array.from([...pixel, ...pixel, ...pixel, ...pixel]),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const files = new Map([["p.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/p.png", input);
        const argv = ["p.png", "-fill", "lime",
            "-floodfill", "+0+0", "not-a-color", "PNG64:o.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("magick: unrecognized color `not-a-color'\n");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/o.png") : files.get("o.png")!;
        const expected = background === "black" ? [0, 255, 0, 255] : pixel;
        expect([...decodeImage(output).data]).toEqual([...expected, ...expected, ...expected, ...expected]);
    });
}
