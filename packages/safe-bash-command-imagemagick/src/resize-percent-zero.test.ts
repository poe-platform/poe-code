import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI rejects percentage dimensions rounded
// to zero, but -sample 20% and literal 0x0 both produce 696970707777ffff.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["-sample", "10%", 1],
        ["-sample", "50x1%", 1],
        ["-sample", "1x50%", 1],
        ["-scale", "0%", 1],
        ["-resize", "0%", 1],
        ["-thumbnail", "0%", 1],
        ["-sample", "20%", 0],
        ["-sample", "0x0", 0],
    ] as const)(`${mode}: %s %s returns %i and preserves output on failure`, async (option, geometry, exitCode) => {
        const input = Uint8Array.from([
            ...new TextEncoder().encode("P6\n4 3\n255\n"),
            ...Array.from({ length: 36 }, (_, i) => i * 7),
        ]);
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/out", original]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", input);
        await filesystem.writeFile("/out", original);
        const args = ["/in.ppm", option, geometry, "PNG64:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(exitCode);
        const output = mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out") : files.get("/out")!;
        if (exitCode === 1) {
            expect(output).toEqual(original);
        } else {
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([1, 1]);
            expect(Array.from(image.data16!)).toEqual([0x6969, 0x7070, 0x7777, 0xffff]);
        }
    });
}
