import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = readFileSync(new URL("./fixtures/rotate-background.png", import.meta.url));
// ImageMagick 7.1.2-35 Q16-HDRI: magick input.png -rotate 30 PNG32:output.png.
const native = decodeImage(readFileSync(new URL("./fixtures/rotate-background-native.png", import.meta.url)));

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([undefined, "#22dd44", "white"])(`rotates with stored PNG background or explicit %s (${mode})`, async background => {
        expect(decodeImage(input).backgroundColor).toEqual({ r: 34, g: 221, b: 68, a: 255 });
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...(background ? ["-background", background] : []), "-rotate", "30", "PNG32:out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([9, 9]);
        expect([...output.data.slice(0, 4)]).toEqual(background === "white" ? [255, 255, 255, 255] : [34, 221, 68, 255]);
        if (background !== "white") expect(output.data).toEqual(native.data);
    });
}
