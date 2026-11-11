import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact output from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { space: "HSL", alpha: ["off"], after: [], depth: "8", coder: "rgba", expected: "1061a0ff" },
    { space: "Lab", alpha: ["off"], after: [], depth: "8", coder: "rgba", expected: "17609fff" },
    { space: "HSL", alpha: ["disassociate"], after: [], depth: "8", coder: "rgba", expected: "ff5f5fff" },
    { space: "Lab", alpha: ["disassociate"], after: [], depth: "8", coder: "rgba", expected: "ff0093ff" },
    { space: "HSL", alpha: ["off"], after: [], depth: "16", coder: "rgba", expected: "10106060a0a0ffff" },
    { space: "HSL", alpha: ["off"], after: [], depth: "8", coder: "rgb", expected: "1061a0" },
    { space: "HSL", alpha: ["on"], after: [], depth: "8", coder: "rgba", expected: "1061a080" },
    { space: "HSL", alpha: ["off", "on"], after: [], depth: "8", coder: "rgba", expected: "1061a0ff" },
    { space: "sRGB", alpha: ["off"], after: [], depth: "8", coder: "rgba", expected: "1060a0ff" },
    { space: "HSL", alpha: ["off"], after: ["-colorspace", "sRGB"], depth: "8", coder: "rgba", expected: "1060a0ff" },
])(`${mode}: $space $alpha $after $coder depth=$depth`, async ({ space, alpha, after, depth, coder, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const argv = ["xc:#1060A080", "-colorspace", space, ...alpha.flatMap(value => ["-alpha", value]),
        ...after, "-depth", depth, "-endian", "MSB", `${coder}:-`];
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

for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const space of ["HSL", "Lab"])
for (const depth of [8, 16])
it.each(["off", "disassociate"])(`${mode}: ${space} depth=${depth} %s exports opaque alpha without changing retained samples`, async alpha => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const argv = ["xc:#1060A080", "-colorspace", space, "-alpha", alpha, "-depth", String(depth), "-endian", "MSB",
        "-write", "rgb:/rgb", "-write", "rgba:/opaque", "-alpha", "activate", "rgba:/active"];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const outputs: Buffer[] = [];
    for (const path of ["/rgb", "/opaque", "/active"]) {
        outputs.push(Buffer.from(mode === "command" || mode === "retained" ? await fs.readFile(path) : files.get(path)!));
    }
    const [rgb, opaque, active] = outputs;
    expect(opaque!.toString("hex")).toBe(rgb!.toString("hex") + "ff".repeat(depth / 8));
    expect(active!.toString("hex")).toBe(rgb!.toString("hex") + (alpha === "off" ? "00" : "80").repeat(depth / 8));
});
