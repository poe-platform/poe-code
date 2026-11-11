import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n2 1\n255\n"), Buffer.from("0a141e5a6e82", "hex")]);

// ImageMagick 7.1.2-35 Q16-HDRI references for this two-pixel input.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    [[], "3x3+64+1", "14202b506275"],
    [[], "1x1+64+1", "0a141e5a6e82"],
    [[], "%[fx:w+1]x3+64+1", "14202b506275"],
    [[], "%[fx:w-1]x1+64+1", "0a141e5a6e82"],
    [["-set", "option:geom", "3x3+64+1"], "%[option:geom]", "14202b506275"],
    [["-set", "option:geom", "1x1+64+1"], "%[option:geom]", "0a141e5a6e82"],
    [["-set", "geom", "3x3+64+1"], "%[geom]", "14202b506275"],
] as const)(`expands bilateral blur geometry (${mode}): %j %s`, async (settings, geometry, expected) => {
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const argv = ["/in.ppm", ...settings, "-bilateral-blur", geometry, "-depth", "8", "rgb:/out.rgb"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    const diagnostic = "stderr" in result ? result.stderr : stderr;
    expect(result.exitCode).toBe(0);
    expect(diagnostic).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.rgb") : files.get("/out.rgb")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
