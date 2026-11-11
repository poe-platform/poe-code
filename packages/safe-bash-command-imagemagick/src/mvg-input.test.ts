import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const drawing = "push graphic-context\nviewbox 0 0 2 2\nfill red\nrectangle 0,0 1,1\npop graphic-context\n";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    async function run(argv: string[], text = drawing) {
        const bytes = new TextEncoder().encode(text);
        const original = Uint8Array.of(42);
        const files = new Map([["drawing.mvg", bytes], ["out.png", original]]);
        if (mode === "sync" || mode === "buffered") {
            const result = mode === "sync" ? runMagickCliSync(argv, files, bytes) : await runMagickCli(argv, files, bytes);
            return { ...result, destination: files.get("out.png")! };
        }
        const fs = new MemoryFileSystem();
        await fs.writeFile("/drawing.mvg", bytes);
        await fs.writeFile("/out.png", original);
        if (mode === "retained") {
            const result = await runMagickCli(argv, { filesystem: fs, cwd: "/" }, bytes);
            return { ...result, destination: await fs.readFile("/out.png") };
        }
        const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })(),
            stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        return { ...result, stderr, stdoutBytes: Buffer.concat(chunks), destination: await fs.readFile("/out.png") };
    }

    it.each(["mvg:drawing.mvg", "MVG:drawing.mvg", "mvg:-"])(`${mode}: renders explicit %s as four opaque red pixels`, async operand => {
        const result = await run([operand, "-depth", "8", "rgba:-"]);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("ff0000ff".repeat(4));
    });

    it(`${mode}: does not automatically detect an unprefixed MVG drawing`, async () => {
        const result = await run(["drawing.mvg", "-depth", "8", "rgba:-"]);
        expect(result.exitCode).toBe(1);
        expect(result.stdoutBytes?.length ?? 0).toBe(0);
    });

    it(`${mode}: accepts an explicit canvas size without a viewbox`, async () => {
        const result = await run(["-size", "2x2", "mvg:drawing.mvg", "-depth", "8", "rgba:-"], "fill red rectangle 0,0 1,1");
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("ff0000ff".repeat(4));
    });

    it(`${mode}: honors an explicit size and background over the viewbox`, async () => {
        const result = await run(["-size", "3x2", "-background", "blue", "mvg:drawing.mvg", "-depth", "8", "rgba:-"]);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(("ff0000ff".repeat(2) + "0000ffff").repeat(2));
    });

    it(`${mode}: preserves the MVG format and dimensions through later edits`, async () => {
        const result = await run(["mvg:drawing.mvg", "-flip", "-format", "%m %wx%h", "info:"]);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect("stdout" in result ? result.stdout : new TextDecoder().decode(result.stdoutBytes)).toBe("MVG 2x2");
    });

    it.each([
        ["fill red rectangle 0,0 1,1", "must specify image size"],
        ["viewbox 0 0 0 2", "must specify image size"],
        ["viewbox 0 0 1000000000 1000000000", "resource limits"],
        ["viewbox 0 0 2 2\nfill red rectangle 0,0", "finite numeric coordinates"]
    ])(`${mode}: preserves the destination for invalid MVG: %s`, async (text, error) => {
        const result = await run(["mvg:drawing.mvg", "out.png"], text);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(error);
        expect(result.stdoutBytes?.length ?? 0).toBe(0);
        expect(result.destination).toEqual(Uint8Array.of(42));
    });
}
