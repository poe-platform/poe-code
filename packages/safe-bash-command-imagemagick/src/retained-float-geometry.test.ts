import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

it.each([
    ["-extent", "520x3"],
    ["-splice", "1x1+2+1", "-chop", "1x1+2+1"],
    ["-emboss", "1"],
])("bounds retained floating-point reads for %s", async (...operations) => {
    const input = Uint8Array.from([...new TextEncoder().encode("P5\n513 2\n255\n"), ...Array.from({ length: 1026 }, (_, i) => i % 251)]);
    const files = new Map([["/input.pgm", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.pgm", input);
    const args = ["/input.pgm", "-gamma", "1.4", ...operations, "/out.png"];
    expect(await runConvertCli(args, files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(await runConvertCli(args, { filesystem, cwd: "/" })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(decodeImage(await filesystem.readFile("/out.png"))).toEqual(decodeImage(files.get("/out.png")!));
});
