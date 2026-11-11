import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Complete raw output from native ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { offset: "50:0", expected: "05050f0f" },
        { offset: "0:50", expected: "01030b0d" },
        { offset: "0:0", expected: "01030b0d" },
        { offset: "50:0+1+1", expected: "05050f0f" },
        { offset: "0:50+1+1", expected: "01030b0d" },
        { offset: "50:25", expected: "01030b0d" },
        { offset: "50x0", expected: "02040709" },
        { offset: "0x50", expected: "01030b0d" },
        { offset: "50:25", gradient: true, expected: "ff0000ff00005500aa5500aa" },
        { offset: "0:50", gradient: true, expected: "ff0000ff00005500aa5500aa" },
    ])(`${mode} samples zero-axis ratios $offset (gradient=$gradient)`, async ({ offset, gradient, expected }) => {
        const input = new Uint8Array([...new TextEncoder().encode("P5\n5 4\n255\n"), ...Array.from({ length: 20 }, (_, i) => i + 1)]);
        const files = new Map([["in.pgm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pgm", input);
        const args = [...(gradient ? ["-size", "5x4", "gradient:red-blue"] : ["in.pgm", "-repage", "11x8-2+1"]),
            "-define", `sample:offset=${offset}`, "-sample", "2x2!", "-depth", "8", `${gradient ? "rgb" : "gray"}:out`];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
