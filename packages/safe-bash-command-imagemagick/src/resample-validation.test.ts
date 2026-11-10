import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

const input = new Uint8Array(Buffer.concat([
    Buffer.from("P6\n3 2\n255\n"),
    Buffer.from("ff000000ff000000ffffee00991177245384", "hex")
]));
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    ["bogus", undefined],
    ["72junk", undefined],
    ["144:72", undefined],
    ["0x72", undefined],
    ["144", "6x4,144,144"],
    ["72x144", "3x4,72,144"]
] as const)(`${mode}: validates resample density %s before replacing output`, async (density, expected) => {
    const files = new Map([["/im.ppm", input], ["/out", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/im.ppm", input);
    await fs.writeFile("/out", keep);
    const args = ["/im.ppm", "-filter", "point", "-resample", density, "-format", "%wx%h,%x,%y", "info:/out"];
    let result;
    if (mode === "command") {
        let stdout = "", stderr = "";
        const status = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        result = { ...status, stdout, stderr };
    } else result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    const { stdout, stderr } = result;
    const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(stdout).toBe("");
    expect(result.exitCode, stderr).toBe(expected === undefined ? 1 : 0);
    expect(output).toEqual(expected === undefined ? keep : new TextEncoder().encode(expected));
    if (expected !== undefined) expect(stderr).toBe("");
    else if (density === "144:72") expect(stderr).toContain("negative or zero image size");
    else {
        expect(stderr).toContain("invalid argument");
        expect(stderr).toContain("-resample");
        expect(stderr).toContain(density);
    }
});

for (const retained of [false, true])
it.each(["bogus", "72junk", "144:72", "0x72"])(`mogrify preserves input for invalid resample density %s (retained=${retained})`, async density => {
    const files = new Map([["/im.ppm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/im.ppm", input);
    const result = await runMogrifyCli(["-resample", density, "/im.ppm"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(retained ? await filesystem.readFile("/im.ppm") : files.get("/im.ppm")).toEqual(input);
});
