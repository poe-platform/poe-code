import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, raw RGBA in row-major order.
for (const backend of ["buffered", "retained", "sync", "command"] as const)
it.each([
    ["CopyRed", 8, "31502060", "d2f5a035fa9ef2f18299feaeed83380a920c1d6b11770e5b36214ac635b8b079"],
    ["CopyGreen", 8, "b4692060", "ade33fb81b36c1515527114e4487ff2ef16f4c2495e2f13551cd077f8b75e4a7"],
    ["CopyBlue", 8, "b450af60", "79ffd5e618d1c1a947ce67ec79c21092a4493d4e5da2d97186e4d37d509a923a"],
    ["CopyAlpha", 8, "b450200d", "a1e9d0771145ea953e6b2352743760f013737268e4e602ce6163b35f64218353"],
    ["CopyRed", 16, "3131505020206060", "5d2eade34fd7f98ddeca6f1a98679387e11b64c676ce79f548986526752d2ef4"],
    ["CopyGreen", 16, "b4b4696920206060", "c355630fb8f55bef066d32a03d7c0b9c88bd8571e927c9ad7cde68de13f540ae"],
    ["CopyBlue", 16, "b4b45050afaf6060", "4400d8d23725069989ba4019ab4e153eb9ac5ae74fb5495e8277b0f9bf23b012"]
] as const)(`copies only the named vignette channel for %s at depth %i (${backend})`, async (compose, depth, corner, hash) => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const argv = ["-size", "7x5", "xc:#3169af80", "-background", "#b4502060", "-compose", compose,
        "-vignette", "0x1+1+1", "-depth", String(depth), "-endian", "MSB", "rgba:/output.raw"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = backend === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : backend === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, backend === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = backend === "retained" || backend === "command" ? await filesystem.readFile("/output.raw") : files.get("/output.raw")!;
    expect(output.length).toBe(7 * 5 * 4 * depth / 8);
    expect(Buffer.from(output.slice(0, 4 * depth / 8)).toString("hex")).toBe(corner);
    expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
});
