import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI copies fractional Lab samples into mixed sRGB output.
for (const mode of ["command", "filesystem", "map", "sync"] as const)
for (const direction of ["+append", "-append"])
it.each([
    { name: "mixed pixel", inputs: ["xc:red"], output: ["-format", "%[pixel:p{0,0}]", "info:/out"], expected: "srgba(21.0427%,50.4151%,40.547%,0.501961)", text: true },
    { name: "mixed inks", inputs: ["xc:red"], output: ["-depth", "16", "-endian", "MSB", "cmyka:/out"], expected: "95250000321c7eef80800000ffffffff0000ffff", text: false },
    { name: "relabeled control", inputs: ["-set", "colorspace", "sRGB", "xc:red"], output: ["-format", "%[pixel:p{0,0}]", "info:/out"], expected: "srgba(21.0427%,50.4151%,40.547%,0.501961)", text: true },
    { name: "Lab control", inputs: ["+clone"], output: ["-format", "%[pixel:p{0,0}]", "info:/out"], expected: "cielaba(21.0427,1.05838,-24.1051,0.501961)", text: true },
])(`${mode} ${direction}: $name`, async ({ inputs, output, expected, text }) => {
    const fs = createMemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["xc:#12345680", "-colorspace", "Lab", ...inputs, direction, ...output];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(text ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("hex")).toBe(expected);
});
