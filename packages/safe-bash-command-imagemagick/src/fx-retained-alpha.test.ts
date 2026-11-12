import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI weights coordinate lookups by retained
// alpha, even after disassociation disables alpha in the formatted color.
const direct = "srgb(7.05882e+12%,2.03922e+13%,3.37255e+13%)";
const format = "%[pixel:p{0,0}]|%[fx:p{0,0}.r]|%[fx:p{0.25,0.25}.r]|%[fx:p{0,0}.a]|%[pixel:u]|%[fx:u.r]";
const cases = [
    ...["default", "bilinear", "blend", "mesh", "catrom", "spline", "average", "average9", "average16"].map(method => ({
        name: `disassociated transparent pixel with ${method} interpolation`,
        color: "#12345600", options: ["-alpha", "disassociate", ...(method === "default" ? [] : ["-interpolate", method])],
        expected: `srgb(0,0,0)|0|0|0|${direct}|7.05882e+10`
    })),
    ...["nearest", "integer"].map(method => ({
        name: `unweighted ${method} lookup`, color: "#12345600", options: ["-alpha", "disassociate", "-interpolate", method],
        expected: `${direct}|7.05882e+10|7.05882e+10|0|${direct}|7.05882e+10`
    })),
    { name: "nonzero disassociated alpha", color: "#12345680", options: ["-alpha", "disassociate"],
        expected: "srgb(14.0625%,40.625%,67.1875%)|0.140625|0.140625|0.501961|srgb(14.0625%,40.625%,67.1875%)|0.140625" },
    { name: "retained alpha after disassociate then off", color: "#12345600", options: ["-alpha", "disassociate", "-alpha", "off"],
        expected: `srgb(0,0,0)|0|0|0|${direct}|7.05882e+10` },
    ...["deactivate", "discrete"].map(alpha => ({
        name: `${alpha} retains transparent samples`, color: "#12345600", options: ["-alpha", alpha],
        expected: "srgba(0,0,0,0)|0|0|0|srgba(18,52,86,0)|0.0705882"
    })),
    { name: "off removes active alpha", color: "#12345600", options: ["-alpha", "off"],
        expected: "srgb(18,52,86)|0.0705882|0.0705882|0.0705882|srgb(18,52,86)|0.0705882" }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`${mode}: $name`, async ({ color, options, expected }) => {
        const argv = [`xc:${color}`, ...options, "-format", format, "info:"];
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
