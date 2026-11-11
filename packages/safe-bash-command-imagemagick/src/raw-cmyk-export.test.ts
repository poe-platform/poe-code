import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: direct RGB export clamps inks before conversion.
const tint = ["xc:#4080a080", "-colorspace", "CMYK", "-fill", "#bf6050", "-tint", "60%"];
const deskew = ["xc:#326496", "xc:#dccdb9", "+append", "-colorspace", "CMYK", "-filter", "Catrom", "-deskew", "40%"];
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { name: "tinted RGBA", input: tint, after: [], coder: "rgba", expected: "66f1ff80" },
    { name: "tinted RGB", input: tint, after: [], coder: "rgb", expected: "66f1ff" },
    { name: "tinted stored chunk boundary", input: ["-size", "513x1", ...tint], after: [], coder: "rgba", expected: "66f1ff80".repeat(513) },
    { name: "intermediate RGB write preserves inks", input: tint, after: ["-write", "rgb:/preview", "-colorspace", "sRGB"], coder: "rgba", expected: "6bfdff80" },
    { name: "tinted inks", input: tint, after: [], coder: "cmyk", expected: "990e0000" },
    { name: "explicit sRGB", input: tint, after: ["-colorspace", "sRGB"], coder: "rgba", expected: "6bfdff80" },
    { name: "explicit clamp", input: tint, after: ["-clamp"], coder: "rgba", expected: "66f1ff80" },
    { name: "untinted", input: ["xc:#4080a080", "-colorspace", "CMYK"], after: [], coder: "rgba", expected: "4080a080" },
    { name: "deskew", input: deskew, after: [], coder: "rgba", expected: "32656cffcececeff" },
    { name: "deskew clamp", input: deskew, after: ["-clamp"], coder: "rgba", expected: "32656cffcececeff" },
    { name: "deskew sRGB", input: deskew, after: ["-colorspace", "sRGB"], coder: "rgba", expected: "326597fffffff2ff" },
])(`${mode}: $name`, async ({ name, input, after, coder, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const argv = [...input, ...after, "-depth", "8", `${coder}:-`];
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
    const bytes = Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout));
    const pixels = name.startsWith("deskew") ? bytes.subarray(bytes.length / 2 - 4, bytes.length / 2 + 4) : bytes;
    expect(pixels.toString("hex")).toBe(expected);
});
