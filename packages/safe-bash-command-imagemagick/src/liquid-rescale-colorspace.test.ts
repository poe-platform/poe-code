import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI with liblqr, raw 8-bit RGB output.
for (const mode of ["public", "buffered", "retained", "sync"] as const) {
    it.each([
        ["HSL", "4x4!", 48, "27f57eb0b4d0faa542e7b9bb4b0c9c820d589dd8e4f54115fe4454de334b736f"],
        ["HSL", "6x4!", 72, "4d9c26e08b2d339e23786acb2cb87c57ed0d1bb4cfb1ddfe59c8afe5d53b8ac0"],
        ["Lab", "4x4!", 48, "811ac43720beef0ed8ab20041447c4f32e891fa9210f8265964f2b4dde45a2b4"],
        ["HSL", "5x4!", 60, "c9a65f38f3665df178b32e7ef826b9f2be4fea37c0ee7db1c09ef89b9f91427b"],
        ["Lab", "5x4!", 60, "c9a65f38f3665df178b32e7ef826b9f2be4fea37c0ee7db1c09ef89b9f91427b"],
        ["sRGB", "4x4!", 48, "36448a5c794e94c6bcdaf41045ee6c339a800f80ab00771e6c446701bd0bd08b"],
    ] as const)(`carves %s working samples to %s (${mode})`, async (space, geometry, length, digest) => {
        const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256))]);
        const files = new Map<string, Uint8Array>([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/im.ppm", ...(space === "sRGB" ? [] : ["-colorspace", space]), "-liquid-rescale", geometry,
            ...(space === "sRGB" ? [] : ["-colorspace", "sRGB"]), "-depth", "8", "rgb:/out"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output.length).toBe(length);
        expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
    });
}
