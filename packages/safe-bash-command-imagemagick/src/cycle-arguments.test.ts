import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEX/AAAA/wAAAP///wDWAo97AAAADUlEQVR4nGNgYGRiBgAADwAHhI6ZbQAAAABJRU5ErkJggg==", "base64"));
const palette = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    // Native ImageMagick validates geometry, then reads its leading decimal integer.
    it.each([
        ["1", 1], ["2", 2], ["-1", -1], ["1e1", 1], ["1.5", 1], ["1x2", 1],
        ["0b10", undefined], ["invalid", undefined], ["", undefined]
    ] as const)(`${mode} parses -cycle %j without damaging existing output`, async (argument, shift) => {
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/input.png", input], ["/out.png", original]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/input.png", "-cycle", argument, "/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        if (shift === undefined) {
            expect(output).toEqual(original);
            expect(result.exitCode).toBe(1);
            expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument for option '-cycle'");
        } else {
            expect(result.exitCode, stderr).toBe(0);
            expect([...decodeImage(output).data]).toEqual(palette.flatMap((_, index) => palette[(index + shift + 4) % 4]!));
        }
    });
}
