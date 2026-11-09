import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = readFileSync(new URL("./fixtures/rotate-intermediate-input.png", import.meta.url));
// ImageMagick 7.1.2-35 Q16-HDRI: input.png -rotate 30 +repage -rotate -30 PNG32:out.png.
const native = decodeImage(readFileSync(new URL("./fixtures/rotate-intermediate-native.png", import.meta.url)));

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it(`${mode}: retains intermediate precision between rotations of 8-bit input`, async () => {
        const filesystem = new MemoryFileSystem(), files = new Map([["/input.png", input]]);
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-rotate", "30", "+repage", "-rotate", "-30", "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const actual = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([actual.width, actual.height]).toEqual([18, 17]);
        expect(actual.virtualCanvas).toMatchObject({ x: -3, y: -3 });
        expect(actual.data).toEqual(native.data);
    });
}
