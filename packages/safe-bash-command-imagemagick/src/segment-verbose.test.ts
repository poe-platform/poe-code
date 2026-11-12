import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Exact stdout from ImageMagick 7.1.2-35 Q16-HDRI.
const bands = {
    "args": [
        "-size",
        "32x32",
        "xc:red",
        "xc:lime",
        "xc:blue",
        "+append",
        "-verbose",
        "-segment",
        "1x1",
        "-format",
        "COLORS=%k",
        "info:"
    ],
    "stdout": "Fuzzy C-means Statistics\n===================\n\n\tCluster Threshold = 1\n\tWeighting Exponent = 2.5\n\tTotal Number of Clusters = 3\n\n\n\nNumber of Vectors Per Cluster\n=============================\n\nCluster #0 = 1024\nCluster #1 = 1024\nCluster #2 = 1024\n\n\n\nCluster Extents:        (Vector Size: 3)\n================\n\nCluster #0\n\n0-1  0-1  253-253\n\n\nCluster #1\n\n0-1  253-253  0-1\n\n\nCluster #2\n\n253-253  0-1  0-1\n\n\n\nCluster Center Values:        (Vector Size: 3)\n=====================\n\nCluster #0\n\n0  0  255\n\n\nCluster #1\n\n0  255  0\n\n\nCluster #2\n\n255  0  0\n\nCOLORS=3"
};

const fractional = {
    "args": [
        "-size",
        "8x8",
        "xc:red",
        "xc:blue",
        "+append",
        "-verbose",
        "-segment",
        "2.125x1",
        "-format",
        "COLORS=%k",
        "info:"
    ],
    "stdout": "Fuzzy C-means Statistics\n===================\n\n\tCluster Threshold = 2.125\n\tWeighting Exponent = 2.5\n\tTotal Number of Clusters = 1\n\n\n\nNumber of Vectors Per Cluster\n=============================\n\nCluster #0 = 128\n\n\n\nCluster Extents:        (Vector Size: 3)\n================\n\nCluster #0\n\n0-253  0-0  0-253\n\n\n\nCluster Center Values:        (Vector Size: 3)\n=====================\n\nCluster #0\n\n127.5  0  127.5\n\nCOLORS=1"
};

const empty = {
    "args": [
        "xc:#4080c0",
        "-verbose",
        "-segment",
        "1x1",
        "-format",
        "COLORS=%k",
        "info:"
    ],
    "stdout": "Fuzzy C-means Statistics\n===================\n\n\tCluster Threshold = 1\n\tWeighting Exponent = 2.5\n\tTotal Number of Clusters = 0\n\n\n\nNumber of Vectors Per Cluster\n=============================\n\n\n\n\nCluster Extents:        (Vector Size: 3)\n================\n\n\nCluster Center Values:        (Vector Size: 3)\n=====================\nCOLORS=1"
};

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { name: "three clusters", ...bands },
        { name: "fractional centers and threshold", ...fractional },
        { name: "zero clusters", ...empty },
        { name: "nonverbose", args: bands.args.filter(arg => arg !== "-verbose"), stdout: "COLORS=3" },
        { name: "reset verbosity", args: bands.args.flatMap(arg => arg === "-verbose" ? [arg, "+verbose"] : [arg]), stdout: "COLORS=3" },
        { name: "enable verbosity after segmentation", args: [...bands.args.slice(0, 6), "-segment", "1x1", "-verbose", "-format", "COLORS=%k", "info:"], stdout: "COLORS=3" },
        { name: "ordered writes and captured verbosity", args: [...bands.args.slice(0, 6), "-format", "BEFORE|", "-write", "info:", "-verbose", "-segment", "1x1", "+verbose", "-print", "AFTER|", "-format", "COLORS=%k", "info:"], stdout: "BEFORE|" + bands.stdout.replace("COLORS=3", "AFTER|COLORS=3") },
        { name: "each segmentation reports once", args: [...bands.args.slice(0, 6), "-verbose", "-segment", "1x1", "-segment", "1x1", "-format", "COLORS=%k", "info:"], stdout: bands.stdout.replace("COLORS=3", "") + bands.stdout },
    ])(`${mode}: $name`, async ({ args, stdout: expected }) => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
