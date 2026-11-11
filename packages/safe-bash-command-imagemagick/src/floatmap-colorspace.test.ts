import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, little-endian raster bytes at -depth 16.
const fixtures = [
    { name: "HSL", input: ["xc:#4682b4", "-colorspace", "HSL"], pfm: "d964133fae47e13efbfafa3e", phm: "9b380a37d837" },
    { name: "Lab", input: ["xc:#4682b4", "-colorspace", "Lab"], pfm: "8e50063fbdd3f73e7759bf3e", phm: "3338bf37fb35" },
    { name: "XYZ", input: ["xc:#4682b4", "-colorspace", "XYZ"], pfm: "44f53f3ed68d523e6a57ec3e", phm: "003294326337" },
    { name: "YCbCr", input: ["xc:#4682b4", "-colorspace", "YCbCr"], pfm: "867fec3e0943233f049abb3e", phm: "64371a39dd35" },
    { name: "CMYK", input: ["xc:cmyk(10%,20%,30%,40%)"], pfm: "cdcccc3dcdcc4c3e9a99993e", phm: "662e6632cd34" },
    { name: "explicit sRGB", input: ["xc:#4682b4", "-colorspace", "HSL", "-colorspace", "sRGB"], pfm: "8d8c8c3e8382023fb5b4343f", phm: "64341438a639" },
    { name: "extended-range Oklch", input: ["xc:#4682b4", "-colorspace", "Oklch"], pfm: "3b87163f2a72cb3d2d3f8940", phm: "b4385c2e4a44" },
    { name: "Gray", input: ["xc:#4682b4", "-colorspace", "Gray"], pfm: "d2a5f23e", phm: "9537" },
    { name: "alpha", input: ["xc:#4682b480", "-colorspace", "HSL"], pfm: "d964133fae47e13efbfafa3e", phm: "9b380a37d837" },
];

for (const mode of ["command", "buffered", "sync", "retained"] as const) for (const format of ["pfm", "phm"] as const) {
    it.each(fixtures)(`${mode} ${format}: exports $name channels`, async ({ name, input, ...raster }) => {
        // Cross the retained transform and encoder chunk boundaries, and verify that
        // -write leaves the original working channels available for a second output.
        const size = name === "HSL" ? "513 2" : "1 1", count = name === "HSL" ? 1026 : 1;
        const argv = ["-size", size.replace(" ", "x"), ...input, "-depth", "16", "-endian", "LSB",
            "-write", `${format}:/written`, `${format}:-`];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
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
        const magic = format === "pfm" ? name === "Gray" ? "Pf" : "PF" : name === "Gray" ? "Ph" : "PH";
        const expected = Buffer.concat([Buffer.from(`${magic}\n${size}\n-1.0\n`), Buffer.from(raster[format].repeat(count), "hex")]);
        const bytes = Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout));
        expect(bytes.toString("hex")).toBe(expected.toString("hex"));
        expect(Buffer.from(mode === "command" || mode === "retained" ? await fs.readFile("/written") : files.get("/written")!).toString("hex")).toBe(expected.toString("hex"));
    });
}
