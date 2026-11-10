import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI Exclusion semantics, exported as RGBA8.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const operation of [["-composite"], ["-layers", "merge"]])
it.each([
    { inputs: ["xc:none", "xc:#12457880"], expected: "12457880" },
    { inputs: ["xc:#12457880", "xc:#ab8900c0"], expected: "937d45e0" },
    { inputs: ["xc:#124578", "xc:#ab8900"], expected: "a58478ff" },
    { inputs: ["xc:#12457880", "xc:#ab890000"], expected: "12457880" },
    { inputs: ["xc:#12457800", "xc:#ab890000"], expected: "00000000" },
    ...(operation[0] === "-layers" ? [{ inputs: ["xc:#12457880"], expected: "12457880" }] : []),
])(`${mode} ${operation.join(" ")} Exclusion with $inputs matches native`, async ({ inputs, expected }) => {
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("/out")!);
    const args = createCommandArguments([
        ...inputs, "-background", "none", "-compose", "Exclusion", ...operation, "-depth", "8", "rgba:/out",
    ]);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args.args, files)
        : await runMagickCli(args.args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, JSON.stringify(result)).toBe(0);
    const output = mode === "retained" || mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
