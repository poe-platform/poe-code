import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["before input", "after delete", "after input", "no shave"])(`requires an image at shave (%s, ${mode})`, async placement => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...Array.from({ length: 36 }, (_, i) => i * 7)]);
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/out", keep]]), filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = placement === "before input" ? ["-shave", "1x1", "/in.ppm"]
            : placement === "after delete" ? ["/in.ppm", "+delete", "-shave", "1x1", "/in.ppm"]
            : placement === "after input" ? ["/in.ppm", "-shave", "1x1"] : ["/in.ppm"];
        args.push("PNG32:/out");
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
        const empty = placement === "before input" || placement === "after delete";
        expect.soft(result.exitCode).toBe(empty ? 1 : 0);
        if (empty) {
            expect.soft("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-shave'");
            expect(output).toEqual(keep);
        } else {
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            // Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 controls.
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual(placement === "after input" ? [2, 1] : [4, 3]);
            expect(Buffer.from(decoded.data).toString("hex")).toBe(placement === "after input"
                ? "697077ff7e858cff"
                : "00070eff151c23ff2a3138ff3f464dff545b62ff697077ff7e858cff939aa1ffa8afb6ffbdc4cbffd2d9e0ffe7eef5ff");
        }
    });
}
