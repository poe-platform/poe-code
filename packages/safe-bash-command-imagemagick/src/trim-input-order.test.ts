import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["before input", "after delete", "after input", "no trim"])(`requires an image at trim (%s, ${mode})`, async placement => {
        const pixels = Array.from({ length: 30 }, () => [100, 120, 140]);
        pixels[1] = [102, 120, 140];
        pixels[14] = [26, 38, 54];
        pixels[15] = [50, 100, 130];
        pixels[20] = [69, 21, 90];
        pixels[21] = [200, 230, 17];
        const input = new Uint8Array([...new TextEncoder().encode("P6\n6 5\n255\n"), ...pixels.flat()]);
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.ppm", input], ["/out", keep]]), filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile(name, bytes);
        const args = placement === "before input" ? ["-trim", "/in.ppm"]
            : placement === "after delete" ? ["/in.ppm", "+delete", "-trim", "/in.ppm"]
            : placement === "after input" ? ["/in.ppm", "-trim"] : ["/in.ppm"];
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
            expect.soft("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-trim'");
            expect(output).toEqual(keep);
        } else {
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            // Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 controls.
            const decoded = decodeImage(output);
            expect([decoded.width, decoded.height]).toEqual(placement === "after input" ? [3, 4] : [6, 5]);
            expect(Buffer.from(decoded.data).toString("hex")).toBe(placement === "after input"
                ? "66788cff64788cff64788cff64788cff64788cff64788cff64788cff1a2636ff326482ff64788cff45155affc8e611ff"
                : Buffer.from(pixels.flatMap(pixel => [...pixel, 255])).toString("hex"));
        }
    });
}
