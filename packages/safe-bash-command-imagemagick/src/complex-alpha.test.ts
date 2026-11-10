import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, RGBA8 in real/imaginary order.
for (const mode of ["buffered", "sync", "retained", "command"])
it.each([
    { operation: "Add", alphaOff: 3, expected: "80b0c03170a0e082" },
    { operation: "Add", alphaOff: 0, expected: "80b0c0ff70a0e082" },
    { operation: "Multiply", alphaOff: 3, expected: "001300311a2b5c82" },
    { operation: "Conjugate", alphaOff: 3, expected: "2070a03100000082" },
    { operation: "Add", alphaOff: -1, expected: "80b0c09170a0e0c6" },
    { operation: "Multiply", alphaOff: -1, expected: "001300001a2b5c3e" },
    { operation: "Conjugate", alphaOff: -1, expected: "2070a03100000000" },
])(`${mode}: complex $operation with alpha off on operand $alphaOff`, async ({ operation, alphaOff, expected }) => {
    const original = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", original]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", original);
    const inputs = ["xc:#2070a031", "xc:#30906082", "xc:#60402060", "xc:#40108044"];
    const argv = [...inputs.flatMap((input, index) => ["(", input, "-alpha", index === alphaOff ? "off" : "on", ")"]),
        "-complex", operation, "+append", "-depth", "8", "rgba:/out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
