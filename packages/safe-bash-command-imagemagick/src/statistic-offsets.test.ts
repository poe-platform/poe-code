import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: offsets require explicit window dimensions.
const input = Uint8Array.from([
    ...new TextEncoder().encode("P6\n5 1\n255\n"),
    3, 112, 200, 81, 25, 149, 221, 112, 50, 98, 80, 70, 11, 31, 240,
]);
const expected = "51517070c8c8ffffdddd7070c8c8ffffdddd70709595ffffdddd7070f0f0ffff62625050f0f0ffff";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(["+2+1", "-2+1", "3x1+2+1", "3x1"])(`${mode}: validates statistic offsets %s before replacing output`, async geometry => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/byte.ppm", input], ["/out.png", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/byte.ppm", input);
    await fs.writeFile("/out.png", keep);
    const args = ["/byte.ppm", "-statistic", "Maximum", geometry, "PNG64:/out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
    if (geometry.startsWith("3")) {
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        const decoded = decodeImage(output);
        expect([decoded.width, decoded.height]).toEqual([5, 1]);
        expect(decoded.data16).toBeDefined();
        expect(Array.from(decoded.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected);
    } else {
        expect(result.exitCode).toBe(1);
        expect(output).toEqual(keep);
        expect(stderr).toContain("invalid argument for option '-statistic'");
        expect(stderr).toContain(geometry);
    }
});
