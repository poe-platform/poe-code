import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const zeroBlack = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0";
// Expected bytes from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "swap cyan and yellow", matrix: "0 0 1 0 1 0 1 0 0", rgb: false, expected: "563412784567abffe0a08000" },
        { name: "zero black", matrix: zeroBlack, rgb: false, expected: "12345600ab67450080a0e000" },
        { name: "copy black into cyan", matrix: "0 0 0 1 0 1 0 0 0 0 1 0 0 0 0 1", rgb: false, expected: "78345678ff6745ff00a0e000" },
        { name: "convert edited inks to RGB", matrix: zeroBlack, rgb: true, expected: "359affff9a6792b6ff" },
        { name: "identity inks", matrix: "1 0 0 0 1 0 0 0 1", rgb: false, expected: "12345678ab6745ff80a0e000" },
        { name: "unmodified RGB round trip", matrix: undefined, rgb: true, expected: "123456ab674580a0e0" }
    ])(`${mode}: $name`, async ({ matrix, rgb, expected }) => {
        const input = rgb ? Buffer.concat([Buffer.from("P6\n3 1\n255\n"), Buffer.from("123456ab674580a0e0", "hex")])
            : Buffer.from("12345678ab6745ff80a0e000", "hex");
        const files = new Map([["in", input], ["out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
        const argv = [
            ...(rgb ? ["in", "-colorspace", "CMYK"] : ["-size", "3x1", "-depth", "8", "cmyk:in"]),
            ...(matrix ? ["-color-matrix", matrix] : []),
            ...(rgb ? ["-colorspace", "sRGB"] : []), "-depth", "8", `${rgb ? "rgb" : "cmyk"}:out`
        ];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
