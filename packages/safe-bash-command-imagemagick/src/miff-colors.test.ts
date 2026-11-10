import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";
import fixtures from "./miff-colors-fixtures.json" with { type: "json" };

// Native ImageMagick fixtures:
// magick -delay 16 -size 2x1 xc:red a.gif
// magick -delay 36 -size 2x1 xc:blue b.gif
// magick -delay 1x24 a.gif -delay 7x1000 b.gif -type TrueColor -compress None source.miff
const source = Buffer.from(fixtures.source, "base64");
const control = Buffer.from(source.toString("latin1").replaceAll("colors=2", "colors=0"), "latin1");

it.each([
    ["source.miff[0]", "srgb(255,0,0)|"],
    ["control.miff[0]", "srgb(255,0,0)|"],
    ["a.gif", "srgb(255,0,0)|"],
    ["blue.miff[0]", "srgb(0,0,255)|"],
    ["source.miff[0] blue.miff[0]", "srgb(255,0,0)|srgb(0,0,255)|"],
    ["blue.miff[0] source.miff[0]", "srgb(0,0,255)|srgb(255,0,0)|"]
])("reads DirectClass colors metadata through magick: %s", async (input, expected) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/source.miff", source);
    await fs.writeFile("/control.miff", control);
    await fs.writeFile("/blue.miff", source.subarray(source.indexOf("id=ImageMagick", 1)));
    await fs.writeFile("/a.gif", Buffer.from(fixtures.gif, "base64"));
    const args = createCommandArguments([...input.split(" "), "-format", "%[pixel:p{0,0}]|", "info:"]);
    let stdout = "", stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
});
