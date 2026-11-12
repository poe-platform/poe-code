import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const ppm = Buffer.concat([Buffer.from("P6\n4 1\n255\n"), Buffer.from([0, 3, 6, 9].flatMap(value => [value, value, value]))]);

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI: even a zero shift assigns a dithered palette.
    it.each([
        { operations: ["-cycle", "1"], expected: "03030900" },
        { operations: ["-cycle", "0"], expected: "00000609" },
        { operations: ["-colors", "256", "-cycle", "1"], expected: "03030900" },
        { operations: ["+dither", "-cycle", "1"], expected: "03060900" },
        { operations: ["+dither", "-cycle", "0"], expected: "00030609" },
        { operations: ["-cycle", "1", "-cycle", "-1"], expected: "00000609" },
        { operations: ["-cycle", "1", "+dither"], expected: "03030900" },
        { operations: ["+dither", "-cycle", "1", "-dither", "Riemersma"], expected: "03060900" },
        { operations: [], expected: "00030609" }
    ])(`${mode}: matches native grayscale palette assignment for $operations`, async ({ operations, expected }) => {
        const files = new Map<string, Uint8Array>([["/in.ppm", ppm]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", ppm);
        const args = ["/in.ppm", ...operations, "-depth", "8", "gray:/out"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
