import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const red = ["(", "xc:#0a141e", "-channel", "Red", ")"];
const blue = ["(", "xc:#0a141e", "-channel", "Blue", ")"];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    // ImageMagick 7.1.2-35 Q16-HDRI, raw 8-bit RGB output.
    it.each([
        { name: "mixed masks", input: [...red, ...blue], operation: ["-solarize", "0"], expected: "f5141e0a14e1" },
        { name: "red alone", input: red, operation: ["-solarize", "0"], expected: "f5141e" },
        { name: "blue alone", input: blue, operation: ["-solarize", "0"], expected: "0a14e1" },
        { name: "no operation", input: [...red, ...blue], operation: [], expected: "0a141e0a141e" },
        { name: "reset masks", input: [...red, ...blue], operation: ["+channel", "-solarize", "0"], expected: "f5ebe1f5ebe1" },
        { name: "replace masks", input: [...red, ...blue], operation: ["-channel", "Green", "-solarize", "0"], expected: "0aeb1e0aeb1e" },
        { name: "default and explicit masks", input: ["(", "xc:#0a141e", ")", ...blue], operation: ["-solarize", "0"], expected: "f5ebe10a14e1" },
    ])(`${mode}: solarizes each image using its own channels ($name)`, async ({ input, operation, expected }) => {
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const argv = [...input, ...operation, "-depth", "8", mode === "command" ? "rgb:-" : "rgb:/out"];
        const args = createCommandArguments(argv);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" ? Buffer.concat(stdout)
            : mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
