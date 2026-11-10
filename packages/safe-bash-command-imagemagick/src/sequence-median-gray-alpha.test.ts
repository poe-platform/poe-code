import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "command"] as const)
for (const depth of [8, 16])
it.each([
    { name: "gray alpha", colors: ["#404040c0", "#80808020"], space: "Gray", operation: "Median", expected: "404040c0" },
    { name: "reversed gray alpha", colors: ["#80808020", "#404040c0"], space: "Gray", operation: "Median", expected: "404040c0" },
    { name: "equal gray alpha", colors: ["#40404080", "#80808080"], space: "Gray", operation: "Median", expected: "80808080" },
    { name: "sRGB alpha", colors: ["#404040c0", "#80808020"], space: "sRGB", operation: "Median", expected: "80808020" },
    { name: "gray mean", colors: ["#404040c0", "#80808020"], space: "Gray", operation: "Mean", expected: "60606070" },
])(`${mode}, ${depth}-bit: matches native sequence $name`, async ({ colors, space, operation, expected }) => {
    // ImageMagick 7.1.2-35 Q16-HDRI ranks gray and alpha once each.
    const files = new Map<string, Uint8Array>([["/out", Buffer.from("KEEP")]]);
    const fs = createMemoryFileSystem();
    await fs.writeFile("/out", Buffer.from("KEEP"));
    const argv = [...colors.map(color => `xc:${color}`), "-colorspace", space,
        "-evaluate-sequence", operation, "-colorspace", "sRGB", "-depth", String(depth), "-endian", "MSB", "rgba:/out"];
    const args = createCommandArguments(argv);
    const result = mode === "command"
        ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        })
        : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    const samples = Buffer.from(expected, "hex");
    expect(Buffer.from(output).toString("hex")).toBe(depth === 8 ? expected
        : Buffer.from([...samples].flatMap(sample => [sample, sample])).toString("hex"));
});
