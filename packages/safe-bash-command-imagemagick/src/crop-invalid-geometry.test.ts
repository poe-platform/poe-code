import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["banana", "3x2oops", "3x2+q+1", "", "3x2+0+0"])(`validates crop %j before writing output (${mode})`, async geometry => {
        const pixels = Uint8Array.from({ length: 35 }, (_, i) => i + 1);
        const input = new Uint8Array([...new TextEncoder().encode("P5\n7 5\n255\n"), ...pixels]);
        const original = await sharp({ create: { width: 1, height: 1, channels: 4, background: "magenta" } }).png().toBuffer();
        for (const output of ["/tile-%02d.png", "/out.png"]) {
            const files = new Map([["/in.pgm", input], ["/out.png", original]]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const args = ["/in.pgm", "-crop", geometry, output];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const valid = geometry === "3x2+0+0";
            expect(result.exitCode).toBe(valid ? 0 : 1);
            expect("stderr" in result ? result.stderr : stderr).toBe(valid ? "" : `magick: invalid argument for option '-crop': ${geometry}\n`);
            if (mode === "command" || mode === "retained") {
                files.clear();
                for (const { name } of await filesystem.readdir("/")) files.set(`/${name}`, await filesystem.readFile(`/${name}`));
            }
            if (!valid) {
                expect([...files.keys()].sort()).toEqual(["/in.pgm", "/out.png"]);
                expect(files.get("/out.png")).toEqual(original);
            } else {
                const image = decodeImage(files.get(output === "/out.png" ? output : "/tile-00.png")!);
                expect([image.width, image.height]).toEqual([3, 2]);
                expect(image.virtualCanvas).toEqual({ width: 7, height: 5, x: 0, y: 0 });
                expect([...image.data].filter((_, i) => i % 4 === 0)).toEqual([1, 2, 3, 8, 9, 10]);
            }
        }
    });
}
