import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI treats a final offset sign as zero.
it.each([
    { operation: "-roll", geometry: "+1-", expected: "0f2c490a2744617e9bb8d5f26b88a56683a0bddaf714314ec7e401c2dffc193653708daa" },
    { operation: "-roll", geometry: "+1+", expected: "0f2c490a2744617e9bb8d5f26b88a56683a0bddaf714314ec7e401c2dffc193653708daa" },
    { operation: "-roll", geometry: "+1+0", expected: "0f2c490a2744617e9bb8d5f26b88a56683a0bddaf714314ec7e401c2dffc193653708daa" },
    { operation: "-chop", geometry: "2x1+1+", expected: "2x2 2x2+0+0 +0 +0;" },
    { operation: "-chop", geometry: "2x1+1-", expected: "2x2 2x2+0+0 +0 +0;" },
    { operation: "-chop", geometry: "2x1+1+0", expected: "2x2 2x2+0+0 +0 +0;" },
    { operation: "-splice", geometry: "2x1+1+", expected: "6x4 6x4+0+0 +0 +0;" },
    { operation: "-splice", geometry: "2x1+1-", expected: "6x4 6x4+0+0 +0 +0;" },
    { operation: "-splice", geometry: "2x1+1+0", expected: "6x4 6x4+0+0 +0 +0;" },
])("preserves dimensions and offsets for $operation $geometry", async ({ operation, geometry, expected }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", Buffer.concat([
        Buffer.from("P6\n4 3\n255\n"),
        Buffer.from(Array.from({ length: 36 }, (_, i) => (29 * i + 10) % 256)),
    ]));
    const roll = operation === "-roll";
    const args = createCommandArguments(["in.ppm", operation, geometry,
        ...(roll ? ["-depth", "8", "rgb:out"] : ["-format", "%wx%h %g %X %Y;", "info:out"])]);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(Buffer.from(await fs.readFile("/out")).toString(roll ? "hex" : "utf8")).toBe(expected);
});
