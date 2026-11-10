import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains alpha differences below one quantum.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { space: "CMYK", unique: false, count: true },
        { space: "CMYK", unique: true, count: true },
        { space: "CMYK", unique: true, count: false },
        { space: "CMYK", unique: false, count: false },
        { space: "sRGB", unique: true, count: false },
        ...["0", "1e-13", "1e-11"].flatMap(factor => [false, true].map(unique => ({
            space: "CMYK", unique, count: true, factor, expected: factor === "1e-11" ? "2/2" : "1/1",
        }))),
    ])(`${mode}: preserves fractional alpha in $space (unique=$unique, count=$count)`, async (fixture) => {
        const { space, unique, count } = fixture;
        const factor = "factor" in fixture ? fixture.factor : "0.1";
        const argv = ["xc:#1111222233338000", "xc:#1111222233338001", "+append", "-colorspace", space,
            "-channel", "A", "-evaluate", "Multiply", factor, "+channel", ...(unique ? ["-unique-colors"] : []),
            ...(count ? ["-format", "%k/%[colors]"]
                : ["-channel", "A", "-evaluate", "Divide", "0.1", "+channel", "-colorspace", "sRGB", "-depth", "16", "-endian", "MSB"]),
            `${count ? "info" : "rgba"}:${mode === "command" ? "-" : "/out"}`];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const args = createCommandArguments(argv), stdout: Buffer[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        if ("stdout" in result) expect(result.stdout).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString(count ? "utf8" : "hex"))
            .toBe("expected" in fixture ? fixture.expected : count ? "2/2" : "11112222333380001111222233338001");
    });
}
