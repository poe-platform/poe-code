import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI raw RGBA, including unchanged endpoints.
for (const mode of ["command", "filesystem", "map", "sync"])
for (const count of [0, 1])
it.each([
    { name: "above-white samples", first: ["xc:#804020", "-evaluate", "Multiply", "3"], second: ["xc:#2080c0"], after: ["-evaluate", "Divide", "3"], expected: "808040402020ffff459b358b3030ffff0ab52ad54040ffff" },
    { name: "negative samples", first: ["xc:#804020", "-evaluate", "Subtract", "60%"], second: ["xc:#2080c0"], after: ["-evaluate", "Add", "30%"], expected: "33b300000000ffff505060607070ffff6cedcd4dffffffff" },
    { name: "fractional samples", first: ["xc:#804020", "-evaluate", "Divide", "7"], second: ["xc:#2080c0", "-evaluate", "Divide", "7"], after: ["-evaluate", "Multiply", "7"], expected: "808040402020ffff505060607070ffff20208080c0c0ffff" },
    { name: "disassociated alpha", first: ["xc:#80402020", "-alpha", "disassociate"], second: ["xc:#2080c0c0", "-alpha", "disassociate"], after: [], expected: "ffffffffffffffffffffffffffffffff2aabaaaaffffffff" },
    { name: "associated alpha", first: ["xc:#80402020", "-alpha", "associate"], second: ["xc:#2080c0c0", "-alpha", "associate"], after: [], expected: "102008100408ffff142834684a95ffff183060c19121ffff" },
    { name: "working samples across storage chunks", size: "2050x2", pixels: 4100, first: ["xc:#804020", "-evaluate", "Multiply", "3"], second: ["xc:#2080c0"], after: ["-evaluate", "Divide", "3"], expected: "808040402020ffff459b358b3030ffff0ab52ad54040ffff" },
    { name: "byte input control", first: ["xc:#804020"], second: ["xc:#2080c0"], after: [], expected: "808040402020ffff505060607070ffff20208080c0c0ffff" }
])(`morph retains $name (${mode}, count=${count})`, async ({ first, second, after, expected, size = "1x1", pixels = 1 }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["-size", size, "(", ...first, ")", "(", ...second, ")", "-morph", String(count), ...after,
        "-depth", "16", "-endian", "MSB", mode === "command" ? "rgba:-" : "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr.push(bytes.slice()); } }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect(Buffer.concat(stderr).toString()).toBe("");
    const output = mode === "command" ? Buffer.concat(stdout)
        : mode === "filesystem" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected.slice(0, 16).repeat(pixels) + (count ? expected.slice(16, 32).repeat(pixels) : "") + expected.slice(32).repeat(pixels));
});
