import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete RGBA8 output from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { operator: "-blur", method: "background", expected: "0dbf16ff13c61dff" },
    { operator: "-gaussian-blur", method: "background", expected: "0dbd16ff14c41eff" },
    { operator: "-blur", method: "edge", expected: "202d3aff445566ff" },
    { operator: "-gaussian-blur", method: "edge", expected: "202d39ff445567ff" },
];

for (const mode of ["command", "sync", "buffered", "retained"] as const)
for (const vertical of [false, true])
for (const beforeInput of [false, true])
it.each(cases)(`${mode}: $operator uses $method pixels (vertical=${vertical}, beforeInput=${beforeInput})`, async ({ operator, method, expected }) => {
    const input = Buffer.concat([
        Buffer.from(`P6\n${vertical ? "1 2" : "2 1"}\n255\n`),
        Buffer.from([10, 20, 30, 90, 110, 130]),
    ]);
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const settings = ["-background", "lime", "-virtual-pixel", method];
    const args = [...(beforeInput ? settings : []), "/in.ppm", "-alpha", "set", ...(beforeInput ? [] : settings),
        operator, "1x1",
        // Later settings must not alter the preceding blur.
        "-background", "red", "-virtual-pixel", "white", "-depth", "8", "rgba:/out.rgba"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result, stderr).toMatchObject({ exitCode: 0 });
    const output = mode === "sync" || mode === "buffered" ? files.get("/out.rgba")! : await fs.readFile("/out.rgba");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
