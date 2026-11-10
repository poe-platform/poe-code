import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(["before input", "after delete", "after input", "no matrix"])(`requires an image at color-matrix (%s, ${mode})`, async placement => {
        const pixels = Buffer.from("123456ab674580a0e0", "hex");
        const input = new Uint8Array([...new TextEncoder().encode("P6\n3 1\n255\n"), ...pixels]);
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["pic.ppm", input], ["out", keep]]), filesystem = new MemoryFileSystem();
        for (const [name, bytes] of files) await filesystem.writeFile("/" + name, bytes);
        const matrix = ["-color-matrix", "1 0 0 0 1 0 0 0 1"];
        const args = placement === "before input" ? [...matrix, "pic.ppm"]
            : placement === "after delete" ? ["pic.ppm", "+delete", ...matrix, "pic.ppm"]
            : placement === "after input" ? ["pic.ppm", "-colorspace", "sRGB", ...matrix, "-colorspace", "sRGB"]
            : ["pic.ppm"];
        args.push("-depth", "8", "rgb:out");
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
        const empty = placement === "before input" || placement === "after delete";
        // Native ImageMagick 7.1.2-35 Q16-HDRI exit status and raw RGB8 bytes.
        expect.soft(result.exitCode).toBe(empty ? 1 : 0);
        expect.soft("stderr" in result ? result.stderr : stderr).toBe(empty ? "magick: no images found for operation '-color-matrix'\n" : "");
        expect(Buffer.from(output).toString("hex")).toBe(empty ? "4b454550" : "123456ab674580a0e0");
    });
}
