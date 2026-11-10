import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, using the issue's asymmetric 5x4 PPM.
for (const [space, geometry, digest] of [
    ["HSL", "4x3!", "965140fa24cfcf905fe1dd8c0627d4ff1612657fdf2c9240a437151b5ea815f3"],
    ["Lab", "7x6!", "17acfdc9ac6d8a09a78384b25d23b242a804f94e592ad496238f99abfda1a357"],
    ["HSL", "5x4!", "c9a65f38f3665df178b32e7ef826b9f2be4fea37c0ee7db1c09ef89b9f91427b"],
    ["Lab", "5x4!", "c9a65f38f3665df178b32e7ef826b9f2be4fea37c0ee7db1c09ef89b9f91427b"],
    ["sRGB", "4x3!", "dd50a492c698a2b9519d14ac38de901ab9376ce35694d7458b78552924395086"]
]) for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it(`adaptively resizes active ${space} samples to ${geometry} (${mode})`, async () => {
        const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256))]);
        const files = new Map<string, Uint8Array>([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, data] of files) await filesystem.writeFile(path, data);
        const args = ["/im.ppm", "-colorspace", space!, "-adaptive-resize", geometry!, "-colorspace", "sRGB", "-depth", "8", "rgb:/out"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const output = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
    });
}
