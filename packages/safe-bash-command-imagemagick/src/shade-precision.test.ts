import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI, including mask blending before output rounding.
for (const [masked, depth, expected] of [
    [false, 8, "9b8d8d8d9b84787878849b8d8d8d9b"],
    [false, 16, "9bc18dc88dc88dc89bc1848d78e978e978e9848d9bc18dc88dc88dc89bc1"],
    [true, 8, "92807d7b84746f7379859699a3aebd"],
    [true, 16, "928280a57d277afe845a74666f65739f792d8596970a999ba36bae91be1c"]
] as const) {
    it.each(["public", "buffered", "sync"])(`retains shade precision at depth ${depth}, masked ${masked}, %s`, async mode => {
        const input = Uint8Array.from([...new TextEncoder().encode("P5\n5 3\n255\n"), ...Array.from({ length: 15 }, (_, i) => 17 + 13 * i)]);
        const files = new Map([["/in.pgm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.pgm", input);
        const args = ["/in.pgm", ...(masked ? ["-write-mask", "/in.pgm"] : []), "-shade", "0x45", "-endian", "MSB", "-depth", String(depth), "gray:/out.gray"];
        if (mode === "public") {
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
        } else {
            expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files)).toMatchObject({ exitCode: 0 });
        }
        expect(Buffer.from(mode === "public" ? await fs.readFile("/out.gray") : files.get("/out.gray")!).toString("hex")).toBe(expected);
    });
}
