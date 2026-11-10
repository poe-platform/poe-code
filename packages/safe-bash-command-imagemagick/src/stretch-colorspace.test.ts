import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGB output for the issue's PPM fixture.
const input = new TextEncoder().encode(`P3
4 2
255
19 61 200 91 125 39 120 85 65 198 183 17
213 210 98 220 90 179 67 85 190 141 184 70
`);
const cases = [
    ["Lab", "-contrast-stretch", "0032cc33660087430000ff7000ff70ff8aff0032cc00ff70"],
    ["Lab", "-linear-stretch", "0058d41863000c1b0066ff0000ff30e100ff0081e000ff70"],
    ["HSL", "-contrast-stretch", "1800290000000000001c0000e08585f26f6f683e6e5d4545"],
    ["HSL", "-linear-stretch", "5600b43710103d3333ac0000e58585ef79799144bbad4c4c"],
    ["Lab", "", "133dc85b7d27785541c6b711d5d262dc5ab34355be8db846"],
    ["HSL", "", "133dc85b7d27785541c6b711d5d262dc5ab34355be8db846"],
    ["sRGB", "-contrast-stretch", "0000ff076c005d0000ffff00ffff1cff04ff0000ff9cff00"],
] as const;

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: %s %s survives conversion to sRGB`, async (space, operation, expected) => {
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/a.ppm", input], ["/out", keep]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/a.ppm", input);
        await filesystem.writeFile("/out", keep);
        const argv = ["/a.ppm", "-colorspace", space, ...(operation ? [operation, "1x1"] : []), "-colorspace", "sRGB",
            "-endian", "MSB", "-depth", "8", "rgb:/out"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}
