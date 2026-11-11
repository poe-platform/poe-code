import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference RGB bytes.
const cases = [
    { space: "HSL", table: ["xc:#20b040"], expected: "6c5614", working: [0.125490, 0.690196, 0.250980] },
    { space: "Lab", table: ["xc:#20b040"], expected: "11007d", working: [0.125490, 0.690196, 0.250980] },
    { space: "HSL", table: ["(", "xc:#20b040", "xc:#c05088", "+append", ")"], expected: "329691", working: [0.491506, 0.500476, 0.392710] },
    { space: "Lab", table: ["(", "xc:#20b040", "xc:#c05088", "+append", ")"], expected: "2d6eac", working: [0.453094, 0.501803, 0.348424] },
    { space: "sRGB", table: ["(", "xc:#20b040", "xc:#c05088", "+append", ")"], expected: "488076", working: [0.282968, 0.501223, 0.463576] },
    { space: "HSL", table: [], expected: "4080c0", working: [0.583333, 0.503937, 0.501961] },
    { space: "Lab", table: [], expected: "4080c0", working: [0.522121, 0.500415, 0.345117] },
];
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const output of ["rgb", "working"] as const)
it.each(cases)(`${mode}: ${output} after $space CLUT $table`, async ({ space, table, expected, working }) => {
    const filesystem = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const args = ["xc:#4080c0", "-colorspace", space, ...table, ...(table.length ? ["-clut"] : []),
        ...(output === "working" ? ["-format", "%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"]
            : ["-colorspace", "sRGB", "-depth", "8", "rgb:/out"])];
    if (mode === "command") {
        const values = createCommandArguments(args);
        let stdout = "", stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        })).toMatchObject({ exitCode: 0 });
        expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
    } else {
        expect(mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
    if (output === "rgb") expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    else {
        const actual = new TextDecoder().decode(bytes).split(" ").map(Number);
        expect(actual).toHaveLength(3);
        working.forEach((value, channel) => expect(actual[channel]).toBeCloseTo(value, 5));
    }
});

for (const retained of [false, true])
it.each([
    { space: "HSL", expected: "0.12549 0.503937 0.501961" },
    { space: "Lab", expected: "0.12549 0.500415 0.345117" },
])(`retained=${retained}: CLUT preserves unselected $space working samples`, async ({ space, expected }) => {
    const filesystem = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const args = ["xc:#4080c0", "-colorspace", space, "xc:#20b040", "-channel", "R", "-clut", "+channel",
        "-format", "%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"];
    expect(await runMagickCli(args, retained ? { filesystem, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(new TextDecoder().decode(retained ? await filesystem.readFile("/out") : files.get("/out")!)).toBe(expected);
});
