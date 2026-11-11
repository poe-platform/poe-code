import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Complete raw RGB output from native ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "clone artifact", ops: ["(", "+clone", "-set", "artifact:sample:offset", "0", ")"], expected: [10, 14, 34, 38, 1, 4, 17, 20] },
        { name: "image artifact", ops: ["-set", "artifact:sample:offset", "75x25"], expected: [3, 7, 27, 31] },
        { name: "artifact overrides define", ops: ["-define", "sample:offset=25x75", "-set", "artifact:sample:offset", "0"], expected: [1, 4, 17, 20] },
        { name: "define control", ops: ["-define", "sample:offset=75x25"], expected: [3, 7, 27, 31] },
        { name: "clone control", ops: ["(", "+clone", ")"], expected: [10, 14, 34, 38, 10, 14, 34, 38] },
    ])(`${mode} samples with $name`, async ({ ops, expected }) => {
        const input = Uint8Array.from({ length: 48 * 3 }, (_, index) => Math.floor(index / 3) + 1);
        const files = new Map([["/in.rgb", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.rgb", input);
        const args = ["-size", "8x6", "-depth", "8", "rgb:/in.rgb", ...ops, "-sample", "2x2!", "-depth", "8", "rgb:/out.rgb"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.rgb") : files.get("/out.rgb")!;
        expect([...output]).toEqual(expected.flatMap(value => [value, value, value]));
    });
}
