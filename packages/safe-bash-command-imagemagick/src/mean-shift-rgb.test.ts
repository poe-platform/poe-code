import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";
import fixtures from "./mean-shift-rgb-fixtures.json" with { type: "json" };

// Full RGB references from ImageMagick 7.1.2-35 Q16-HDRI. The low-contrast
// input is Python random.Random(2): 100 + randrange(32) for each RGB byte.
for (const mode of ["buffered", "retained", "public"] as const)
for (const fixture of fixtures)
it.each(fixture.cases)(`matches native ${fixture.name} mean shift with $virtual pixels (${mode})`, async ({ virtual, expected }) => {
    const input = Buffer.concat([
        Buffer.from(`P6\n${fixture.width} ${fixture.height}\n255\n`),
        Buffer.from(fixture.input, "hex"),
    ]);
    const files = new Map([["/input.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.ppm", input);
    const argv = ["/input.ppm", "-background", "#103050", "-virtual-pixel", virtual,
        "-mean-shift", fixture.geometry, "-depth", "8", "rgb:/output"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "public" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    }) : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "buffered" ? files.get("/output")! : await fs.readFile("/output");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
