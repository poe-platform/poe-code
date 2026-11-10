import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact RGBA16 controls from ImageMagick 7.1.2-35 Q16-HDRI.
const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n5 1\n255\n"),
    3, 112, 200, 81, 25, 149, 221, 112, 50, 98, 80, 70, 11, 31, 240,
]);
const expected = "1d1d5353b7b7ffff661053538585ffff85db489e5a04ffff6e6e4aa07878ffff28282f85b80dffff";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const source of ["/byte.ppm", "xc:#804020"])
it.each(["Undefined", "undefined", "Mean", "Bogus"])(`${mode}: ${source} statistic %s matches native output`, async method => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/byte.ppm", input], ["/out.png", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/byte.ppm", input);
    await fs.writeFile("/out.png", keep);
    const args = [source, "-statistic", method, "3x1", "PNG64:/out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
    if (method !== "Bogus") {
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([source === "/byte.ppm" ? 5 : 1, 1]);
        expect(decoded.data16).toBeDefined();
        expect(Array.from(decoded.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(source === "/byte.ppm" ? expected : "808040402020ffff");
    } else {
        expect(result.exitCode).toBe(1);
        expect(output).toEqual(keep);
        expect(stderr).toContain("statistic");
        expect(stderr.toLowerCase()).toContain("bogus");
    }
});
