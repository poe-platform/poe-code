import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const rgb = [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0];
const masked = ["-write-mask", "/mask.png"];
// Native ImageMagick 7.1.2: alpha opaque selects mask values above half;
// alpha transparent initializes RGB-only input without masking; negate uses ordinary protection.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { name: "transparent", mask: [255, 0, 0, 0], operations: [...masked, "-alpha", "transparent", "+write-mask"], alpha: [0, 0, 0, 0] },
        { name: "opaque", mask: [255, 0, 0, 0], operations: ["-alpha", "transparent", ...masked, "-alpha", "opaque", "+write-mask"], alpha: [255, 0, 0, 0] },
        { name: "opaque gray mask", mask: [0, 64, 127, 191], operations: ["-alpha", "transparent", ...masked, "-alpha", "opaque", "+write-mask"], alpha: [0, 0, 0, 255] },
        { name: "plain transparent", mask: [255, 0, 0, 0], operations: ["-alpha", "transparent"], alpha: [0, 0, 0, 0] },
        { name: "negate", mask: [255, 0, 0, 0], operations: [...masked, "-negate", "+write-mask"], alpha: [255, 255, 255, 255] },
        { name: "cleared mask", mask: [255, 0, 0, 0], operations: [...masked, "+write-mask", "-negate"], alpha: [255, 255, 255, 255] },
    ])(`${mode}: $name preserves all RGBA tuples`, async ({ name, mask, operations, alpha }) => {
        const input = await sharp(Uint8Array.from(rgb), { raw: { width: 4, height: 1, channels: 3 } }).png().toBuffer();
        const maskBytes = await sharp(Uint8Array.from(mask.flatMap(value => [value, value, value])), { raw: { width: 4, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["/input.png", input], ["/mask.png", maskBytes]]), fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/input.png", ...operations, "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(alpha.flatMap((a, pixel) => [
            ...rgb.slice(pixel * 3, pixel * 3 + 3).map(value => name === "cleared mask" || name === "negate" && pixel > 0 ? 255 - value : value), a,
        ]));
    });
}
