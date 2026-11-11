import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: complete RGB8 output for a tiled three-color row.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { options: ["-paint", "(2x1)"], expected: "0080000000ffff0000" },
        { options: ["-paint", "2x1"], expected: "0080000000ffff0000" },
        { options: ["-paint", "1"], expected: "0000ffff0000008000" },
        { options: ["-set", "option:brush", "(2x1)", "-paint", "%[option:brush]"], expected: "0080000000ffff0000" },
    ])(`${mode}: uses the enclosed paint radius for $options`, async ({ options, expected }) => {
        const args = ["xc:red", "xc:green", "xc:blue", "+append", "-virtual-pixel", "tile", ...options, "-depth", "8", "rgb:-"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        if ("stderr" in result) stderr = String(result.stderr);
        if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout.push(result.stdoutBytes);
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
    });
}

it("uses enclosed paint geometry when mogrify updates an image in place", async () => {
    const input = Buffer.concat([Buffer.from("P6\n3 1\n255\n"), Buffer.from("ff00000080000000ff", "hex")]);
    const files = new Map<string, Uint8Array>([["in.ppm", input]]);
    expect(await runMogrifyCli(["-virtual-pixel", "tile", "-paint", "(2x1)", "in.ppm"], files)).toMatchObject({ exitCode: 0, stderr: "" });
    const result = await runMagickCli(["in.ppm", "-depth", "8", "rgb:-"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("0080000000ffff0000");
});
