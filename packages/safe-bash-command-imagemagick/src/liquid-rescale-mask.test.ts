import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI with liblqr. Remove masks before exporting
// so these assertions isolate seam selection from subsequent masked edits.
const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256))]);
const mask = Buffer.concat([Buffer.from("P5\n5 4\n255\n"), Buffer.from(Array.from({ length: 20 }, (_, i) => i % 2 * 255))]);
const fixtures = [
    ["write-mask", "4x4!", 48, "ab0e462fbbbc8ce143ff7ab8927f8d66fd2e005452deb1b2e3cd06f4c4ea92b6"],
    ["read-mask", "4x4!", 48, "ab0e462fbbbc8ce143ff7ab8927f8d66fd2e005452deb1b2e3cd06f4c4ea92b6"],
    ["region", "6x4!", 72, "87210c81d57819787a5af2d866e2b6913fb38d5709ecced0066d5a5a481c5fd3"],
    ["write-mask", "6x4!", 72, "48994c3f380caf619a15fe758c77efa5c2b5c0a783ade03485c7eb0298914294"],
    ["read-mask", "5x3!", 45, "b5dfa9293b4bb664e467ebdf0728fa5010f76793bc26b9c1453995b8f7ada0be"],
    ["region", "5x5!", 75, "df8fe14fb26b1823ea28e3da0c7b768e2823b76ac8f2711b468d0caed68023b2"],
    ["none", "4x4!", 48, "36448a5c794e94c6bcdaf41045ee6c339a800f80ab00771e6c446701bd0bd08b"],
    ["none", "6x4!", 72, "0f859db4fdc85eaa62dbbfb64486f862a1e1e3185b4812afd505f7134206fb5f"],
    ["write-mask", "5x4!", 60, "c9a65f38f3665df178b32e7ef826b9f2be4fea37c0ee7db1c09ef89b9f91427b"],
] as const;

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(fixtures)(`matches native liquid-rescale with %s at %s (${mode})`, async (kind, geometry, length, sha256) => {
        const files = new Map([["/im.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/im.ppm", ...(kind === "none" ? [] : [`-${kind}`, kind === "region" ? "2x2+1+0" : "/mask.pgm"]),
            "-liquid-rescale", geometry, ...(kind === "none" ? [] : [`+${kind}`]), "-depth", "8", "rgb:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        expect(output).toHaveLength(length);
        expect(createHash("sha256").update(output).digest("hex")).toBe(sha256);
    });
}
