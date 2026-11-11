import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including order and trailing newline.
const gravity = "None\nCenter\nEast\nForget\nNorthEast\nNorth\nNorthWest\nSouthEast\nSouth\nSouthWest\nWest\n";
const metric = "AE\nDPC\nDSSIM\nFuzz\nMAE\nMEPP\nMSE\nNCC\nPAE\nPDC\nPHASE\nPHASH\nPSNR\nRMSE\nSSIM\n";

it.each([
    ["Gravity", gravity], ["gravity", gravity], ["GRAVITY", gravity], ["Metric", metric],
])("magick -list %s writes native names only to stdout", async (category, expected) => {
    const args = createCommandArguments(["-list", category]);
    let stdout = "", stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {},
        fs: new MemoryFileSystem(), signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
});

it.each(["", "convert", "identify", "mogrify", "compare"])(
    "lists gravity through buffered and synchronous magick %j",
    async (subcommand) => {
        const args = [...(subcommand ? [subcommand] : []), "-list", "Gravity"];
        const expected = { exitCode: 0, stdout: gravity, stderr: "" };
        expect(await runMagickCli(args, new Map())).toEqual(expected);
        expect(runMagickCliSync(args, new Map())).toEqual(expected);
    },
);
