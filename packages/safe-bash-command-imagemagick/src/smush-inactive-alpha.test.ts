import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference outputs.
const cases = [
    { direction: "-smush", firstOff: true, secondOff: false, expected: "8040c0ff8040c0ffffffffff8040c0ff8040c0ffffffffff6c54a4ff6c54a4ffcbe3d3ffcbe3d3ffcbe3d3ffcbe3d3ff" },
    { direction: "+smush", firstOff: false, secondOff: true, expected: "bf9fdfff309050ff309050ff309050ffbf9fdfff309050ff309050ff309050ffbf9fdfffbf9fdfffffffffffffffffff" },
    { direction: "-smush", firstOff: true, secondOff: true, expected: "3x4 3x4+0+0 sRGB srgb  3.0;", info: true },
    { direction: "-smush", firstOff: false, secondOff: false, expected: "bf9fdfffbf9fdfffffffffffbf9fdfffbf9fdfffffffffff9b9bbbff9b9bbbffcbe3d3ffcbe3d3ffcbe3d3ffcbe3d3ff" },
    { direction: "+smush", firstOff: false, secondOff: false, expected: "bf9fdfff9b9bbbffcbe3d3ffcbe3d3ffbf9fdfff9b9bbbffcbe3d3ffcbe3d3ffbf9fdfffbf9fdfffffffffffffffffff" }
];
for (const mode of ["command", "buffered", "sync"])
for (const fixture of cases)
it(`${mode} ${fixture.direction}: alpha off ${fixture.firstOff}/${fixture.secondOff}`, async () => {
    const fs = new MemoryFileSystem();
    const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
    await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
    const argv = [
        "(", "-size", "2x3", "xc:#8040c080", ...(fixture.firstOff ? ["-alpha", "off"] : []), ")",
        "(", "-size", "3x2", "xc:#30905040", ...(fixture.secondOff ? ["-alpha", "off"] : []), ")",
        fixture.direction, "-1", ...(fixture.info ? ["-format", "%wx%h %g %[colorspace] %[channels];", "info:/out"] : ["-depth", "8", "rgba:/out"])
    ];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" ? await fs.readFile("/out") : files.get("/out")!;
    expect(fixture.info ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex")).toBe(fixture.expected);
});
