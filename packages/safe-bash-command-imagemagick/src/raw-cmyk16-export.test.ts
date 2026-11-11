import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: RGB16 converts unbounded inks before clamping RGB.
const tint = ["xc:#4278a280", "-colorspace", "CMYK", "-fill", "#d65541", "-tint", "30"];
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { name: "direct RGBA16", before: [], after: [], depth: "16", coder: "rgba", expected: "9b72ffffffff8080" },
    { name: "direct RGB16", before: [], after: [], depth: "16", coder: "rgb", expected: "9b72ffffffff" },
    { name: "explicit sRGB", before: [], after: ["-colorspace", "sRGB"], depth: "16", coder: "rgba", expected: "9b72ffffffff8080" },
    { name: "explicit clamp", before: [], after: ["-clamp"], depth: "16", coder: "rgba", expected: "95a8ff8effff8080" },
    { name: "direct RGBA8", before: [], after: [], depth: "8", coder: "rgba", expected: "95ffff80" },
    { name: "packed RGBA10", before: [], after: [], depth: "10", coder: "rgba", expected: "95bfdffe02" },
    { name: "packed RGBA12", before: [], after: [], depth: "12", coder: "rgba", expected: "95aff8fff808" },
    { name: "unconverted CMYKA16", before: [], after: [], depth: "16", coder: "cmyka", expected: "6a570071000000008080" },
    { name: "stored chunk boundary", before: ["-size", "513x1"], after: [], depth: "16", coder: "rgba", expected: "9b72ffffffff8080".repeat(513) },
    { name: "intermediate RGBA16 write preserves inks", before: [], after: ["-depth", "16", "-write", "rgba:/preview"], depth: "16", coder: "cmyka", expected: "6a570071000000008080" },
])(`${mode}: $name`, async ({ before, after, depth, coder, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const argv = [...before, ...tint, ...after, "-depth", depth, "-endian", "MSB", `${coder}:-`];
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
