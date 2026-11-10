import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI with LQR, using the same 5x4 PPM.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each([
        [true, "4x4!", 1, 4, "1dd17190a2f261044d8e04d099db4ebe2754ff402e5c2b8b759498176ddd343a"],
        [false, "4x4!", 0, 48, "36448a5c794e94c6bcdaf41045ee6c339a800f80ab00771e6c446701bd0bd08b"],
        [false, "5x4!", 0, 60, "c9a65f38f3665df178b32e7ef826b9f2be4fea37c0ee7db1c09ef89b9f91427b"],
    ] as const)(`handles liquid-rescale before input=%s geometry=%s (${mode})`, async (beforeInput, geometry, exitCode, length, hash) => {
        const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256))]);
        const files = new Map<string, Uint8Array>([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = [...(beforeInput ? ["-liquid-rescale", geometry, "/im.ppm"] : ["/im.ppm", "-liquid-rescale", geometry]), "-depth", "8", "rgb:/out"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(exitCode);
        const output = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(output.length).toBe(length);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
