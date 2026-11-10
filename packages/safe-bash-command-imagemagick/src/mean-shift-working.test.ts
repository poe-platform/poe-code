import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import fixtures from "./mean-shift-fixtures.json" with { type: "json" };
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const execution of ["memory", "retained", "command"])
it.each([
    { scale: "2", geometry: "1x1+0" },
    { scale: "2", geometry: "3x3+150%" },
    { scale: "0.3", geometry: "1x1+0" },
    { scale: "0.3", geometry: "3x3+150%" },
    { scale: "2", geometry: undefined },
    { scale: "1", geometry: "1x1+0" },
])(`preserves scaled working samples through mean shift ($scale, $geometry, ${execution})`, async ({ scale, geometry }) => {
    const fs = new MemoryFileSystem(), files = new Map([["out", Buffer.from("KEEP")]]);
    await fs.writeFile("/out", Buffer.from("KEEP"));
    const argv = ["xc:#a0b0c0", "-evaluate", "multiply", scale,
        ...(geometry ? ["-mean-shift", geometry] : []),
        "-evaluate", "divide", scale, "-depth", "8", "rgba:out"];
    if (execution === "command") {
        const args = createCommandArguments(argv);
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        });
        expect(result.exitCode).toBe(0);
    } else {
        const result = await runMagickCli(argv, execution === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
    }
    const output = execution === "memory" ? files.get("out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe("a0b0c0ff");
});

for (const retained of [false, true])
it(`preserves 16-bit working samples through a one-pixel mean shift (retained=${retained})`, async () => {
    const input = Buffer.from(fixtures.depth16.input, "base64");
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const result = await runMagickCli(["input.png", "-evaluate", "multiply", "4", "-mean-shift", "1x1+0", "-evaluate", "divide", "4", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(output.data16).toEqual(decodeImage(input).data16);
});
