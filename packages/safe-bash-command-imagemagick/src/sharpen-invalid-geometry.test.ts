import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI with the same inline two-pixel input.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const output of ["-", "/out"])
it.each([
    ["bad", undefined], ["0x2junk", undefined], ["2..2", undefined],
    ["2..2x1", undefined], ["2+1", undefined], ["2e", undefined],
    ["", undefined], ["!", undefined], ["x", undefined],
    ["0x2", "17123e67b28f9bd9"], ["x2", "17123e67b28f9bd9"],
    ["0x1", "2c234b6fad8a98d1"], ["2", "2d244b70ad8a98d0"]
] as const)(`validates sharpen geometry (${mode}, ${output}): %s`, async (geometry, expected) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", keep]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", keep);
    const args = ["xc:#50406080", "xc:#a08090c0", "+append", "-sharpen", geometry, "-depth", "8", `rgba:${output}`];
    let stderr = "";
    const stdout: Uint8Array[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    const diagnostic = "stderr" in result ? result.stderr : stderr;
    const bytes = output === "-"
        ? "stdout" in result ? Buffer.from(result.stdoutBytes ?? result.stdout) : Buffer.concat(stdout)
        : mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(result.exitCode, diagnostic).toBe(expected === undefined ? 1 : 0);
    if (expected === undefined) {
        expect(diagnostic).toContain("invalid argument for option '-sharpen'");
        expect(diagnostic).toContain(geometry);
        expect(bytes).toEqual(output === "-" ? Buffer.alloc(0) : keep);
    } else {
        expect(diagnostic).toBe("");
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    }
});

for (const retained of [false, true])
it.each(["bad", "0x2junk", "2..2"])(`mogrify preserves input for invalid sharpen geometry %s (retained=${retained})`, async geometry => {
    const input = new TextEncoder().encode("P3\n2 1\n255\n80 64 96 160 128 144\n");
    const files = new Map([["/in.ppm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.ppm", input);
    const result = await runMogrifyCli(["-sharpen", geometry, "/in.ppm"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid argument for option '-sharpen'");
    expect(retained ? await filesystem.readFile("/in.ppm") : files.get("/in.ppm")).toEqual(input);
});
