import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI raw RGBA8, including hidden RGB.
for (const backend of ["buffered", "retained", "sync", "command"] as const)
it.each([
    ["CopyAlpha", "#3876b4", "#d29153", "3958960309eb7672a34a186173046da5b1ff70cf93d7abe9808756d16854421b"],
    ["CopyAlpha", "#3876b480", "#d2915340", "3958960309eb7672a34a186173046da5b1ff70cf93d7abe9808756d16854421b"],
    ["CopyOpacity", "#3876b480", "#d2915340", "3958960309eb7672a34a186173046da5b1ff70cf93d7abe9808756d16854421b"],
    ["Over", "#3876b4", "#d29153", "27e57b059415ca01478c819165f90ede7cd67ede4c99864c7ce1ca266a08a58b"]
])(`matches vignette %s with %s on %s (${backend})`, async (compose, source, background, hash) => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/out", keep]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out", keep);
    const argv = ["-size", "6x4", `xc:${source}`, "-background", background,
        "-compose", compose, "-vignette", "0x0+1+1", "-depth", "8", "rgba:/out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = backend === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : backend === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, backend === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
    const output = backend === "retained" || backend === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(output.length).toBe(6 * 4 * 4);
    expect(Array.from(output.slice(0, 4))).toEqual([210, 145, 83, compose === "Over" ? 255 : 0]);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
