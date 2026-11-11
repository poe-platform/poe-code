import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI complete raw RGB reference outputs.
const cases = [
    { name: "one-third blend multiplied", morph: true, multiply: true, depth: "8", expected: "868d94999ea3a8adb2b9c3c8d0d9dfe4eef7" },
    { name: "one-third blend at 8 bits", morph: true, multiply: false, depth: "8", expected: "595e6266696d7073767b82858a9194989ea5" },
    { name: "one-third blend at 16 bits", morph: true, multiply: false, depth: "16", expected: "59595e5e62b8666669696d177070737376cc7bd1828285db8ae0913b94ea98989ef4a54f" },
    { name: "endpoint multiplied", morph: false, multiply: true, depth: "8", expected: "12293c4d5a6b7a8796adcbdaf0ffffffffff" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each(cases)(`${mode}: $name`, async ({ morph, multiply, depth, expected }) => {
    const argv = ["/in.ppm", ...(morph ? ["(", "/in.ppm", "-negate", ")", "-filter", "Point", "-morph", "2", "-delete", "0,2,3"] : []),
        ...(multiply ? ["-evaluate", "Multiply", "1.5"] : []), "-depth", depth, "-endian", "MSB", "rgb:-"];
    const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from([12, 27, 40, 51, 60, 71, 81, 90, 100, 115, 135, 145, 160, 179, 190, 201, 220, 239])]);
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>([["/in.ppm", input]]);
    await fs.writeFile("/in.ppm", input);
    const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
