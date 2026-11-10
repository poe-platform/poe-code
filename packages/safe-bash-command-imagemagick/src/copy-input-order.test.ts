import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["before input", "after delete", "after input", "no copy"])(`requires an image at copy (%s, ${mode})`, async placement => {
        const input = new Uint8Array([...new TextEncoder().encode("P6\n4 2\n255\n"), ...Array.from({ length: 24 }, (_, i) => i * 10)]);
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/out", keep]]), filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = placement === "before input" ? ["-copy", "1x1+0+0", "+1+0", "/in.ppm"]
            : placement === "after delete" ? ["/in.ppm", "+delete", "-copy", "1x1+0+0", "+1+0", "/in.ppm"]
            : placement === "after input" ? ["/in.ppm", "-copy", "2x1+0+0", "+2+1"] : ["/in.ppm"];
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
            expect.soft("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-copy'");
            expect(output).toEqual(keep);
        } else {
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            // Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 controls.
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual([4, 2]);
            expect(Buffer.from(decoded.data).toString("hex")).toBe(placement === "after input"
                ? "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaff000a14ff1e2832ff"
                : "000a14ff1e2832ff3c4650ff5a646eff78828cff96a0aaffb4bec8ffd2dce6ff");
        }
    });
}
