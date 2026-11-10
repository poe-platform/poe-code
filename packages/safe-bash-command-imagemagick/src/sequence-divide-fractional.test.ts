import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Raw RGBA references from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "map", "sync"] as const)
for (const grouped of [false, true])
it.each([
    { tail: ["-depth", "16", "-endian", "MSB"], expected: "0001000100010003" },
    { tail: ["-evaluate", "Multiply", "30000", "-depth", "8"], expected: "4c5344ff" },
    { tail: ["-depth", "8"], expected: "00000000" },
])(`${mode}: retains Divide fractions for $tail (grouped=${grouped})`, async ({ tail, expected }) => {
    const fs = new MemoryFileSystem();
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    await fs.writeFile("/out", files.get("/out")!);
    const inputs = ["xc:#ef7f4359", "xc:#9c5a27e1"];
    const args = [...inputs.flatMap(input => grouped ? ["(", input, ")"] : [input]),
        "-evaluate-sequence", "Divide", ...tail, "rgba:/out"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
