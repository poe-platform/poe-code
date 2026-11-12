import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    async function run(options: string[], input = ["xc:#173e59", "xc:#b56829", "+append"]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = [...input, "-connected-components", "4", ...options];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        return { files, filesystem, stdout: "stdout" in result ? result.stdout : stdout };
    }

    // ImageMagick 7.1.2-35 Q16-HDRI: these labels differ only below 8-bit precision.
    it.each([
        { operations: [], expected: "000000000000000100010001" },
        { operations: ["-cycle", "1"], expected: "000100010001000000000000" },
        { operations: ["-cycle", "-1"], expected: "000100010001000000000000" },
        { operations: ["-cycle", "2"], expected: "000000000000000100010001" },
        { operations: ["-cycle", "1", "-cycle", "-1"], expected: "000000000000000100010001" },
        { operations: ["-flop", "-cycle", "1"], expected: "000000000000000100010001" },
    ])(`${mode}: preserves component labels through $operations`, async ({ operations, expected }) => {
        const { files, filesystem } = await run([...operations, "-depth", "16", "-endian", "MSB", "rgb:/out"]);
        const bytes = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });

    it(`${mode}: cycles more than 256 labels across raster chunks`, async () => {
        const { files, filesystem } = await run(["-cycle", "257", "-depth", "16", "-endian", "MSB", "rgb:/out"], ["-size", "1031x1", "gradient:black-white"]);
        const bytes = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        const expected = Buffer.alloc(1031 * 6);
        for (let pixel = 0; pixel < 1031; pixel++) for (let channel = 0; channel < 3; channel++) expected.writeUInt16BE((pixel + 257) % 1031, pixel * 6 + channel * 2);
        expect(Buffer.from(bytes)).toEqual(expected);
    });

    it(`${mode}: reports an indexed component-label image`, async () => {
        const { stdout } = await run(["-format", "%r %k", "info:"]);
        expect(stdout).toBe("PseudoClass sRGB  2");
    });
}
