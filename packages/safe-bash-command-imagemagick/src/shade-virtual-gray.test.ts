import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI, exported at byte depth.
it.each([
    ["gray", [], "bbbbbbff8b8b8bff"],
    ["background", ["-background", "gray(50%)"], "bbbbbbff8b8b8bff"],
    ["edge", [], "4d4d4dff4d4d4dff"]
] as const)("matches native shade with %s border pixels", async (method, options, expected) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", Uint8Array.from([
        ...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130
    ]));
    const argumentValues = createCommandArguments([
        "/in.ppm", ...options, "-virtual-pixel", method, "-shade", "0x45", "-depth", "8", "rgba:-"
    ]);
    const stdout: number[] = [];
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Buffer.from(stdout).toString("hex")).toBe(expected);
});
