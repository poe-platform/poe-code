import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete 9x9 raw 8-bit gray rasters.
for (const mode of ["command", "map"] as const)
it.each([
    ["M1,4 A3,3 0 1 1 7,4 A3,3 0 1 1 1,4Z", "075ca69e84fdaebd22af686ccc8c86e2efdd458afb4c93d5b072330c9628f862"],
    ["M1,4 a3,3 0 1 1 6,0 a3,3 0 1 1 -6,0Z", "075ca69e84fdaebd22af686ccc8c86e2efdd458afb4c93d5b072330c9628f862"],
    ["M1,4 A3,2 0 0 1 7,4Z", "b51dcfba39ae9d36f62f5703db5781a1354ebd6b8fecb62d106cad5f33b2ed84"],
    ["M1,4 A3,2 0 0 0 7,4Z", "6d22a687ebd84ff6a22a17a7ac10540bd8ddf3fc69f63a3b59bec1dcdd660928"],
    ["M2,4 A4,2 30 0 1 6,4Z", "66e6363aaf30a8a3875d32a2eedb74770961f3aa3674bd2f656a28c02f001dba"],
    ["M2,4 A4,2 30 1 1 6,4Z", "1fac6e09bc1dbdc4879cbe77819ae83e2d257d6a36e1f792d878672e1540c78c"],
    ["M2,4 A4,2 30 0 0 6,4Z", "6caabc22e3c1ed4bf9881e04f9535b9f921197832edfd93fa34ffe0ea0e3ea90"],
    ["M2,4 A4,2 30 1 0 6,4Z", "25ddcf6199af059b4d347582ab8af9451cbf0b8b4c1d03b0a4e59698acb60ce4"],
    ["M1,4 A1,1 0 0 1 7,4Z", "5df98cf75aa45faa9cf00ee13943f055fb085520811b324ac92694392675329d"],
    ["M1,4 A-3,-2 0 0 1 7,4Z", "b51dcfba39ae9d36f62f5703db5781a1354ebd6b8fecb62d106cad5f33b2ed84"],
    ["M1,4 A0,2 0 0 1 7,4 L4,1Z", "38f3418ebc5a53850ce13bcecfb492b9e7d203ac7d2f3983747225ca8353f7a2"],
    ["M1,4 A3,2 0 0 1 1,4 L7,4 L4,1Z", "38f3418ebc5a53850ce13bcecfb492b9e7d203ac7d2f3983747225ca8353f7a2"],
    ["M1,4 A3,3 0 1 1 7,4 3,3 0 1 1 1,4Z", "075ca69e84fdaebd22af686ccc8c86e2efdd458afb4c93d5b072330c9628f862"],
    ["M1,1H7V7H1Z", "0d3180608d39dd2d857de70c0abb61d5df4b2d64ffef965965f108994526151e"],
])(`${mode}: matches the native raster for %s`, async (path, hash) => {
    const args = ["-size", "9x9", "xc:white", "-fill", "black", "-stroke", "none", "-draw", `path '${path}'`, "-depth", "8", "gray:-"];
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = mode === "map" ? await runConvertCli(args, new Map()) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args,
        cwd: "/", env: {}, fs: new MemoryFileSystem(),
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async bytes => { stdout.push(bytes); } },
        stderr: { write: async bytes => { stderr.push(bytes); } },
    });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(bytes).toHaveLength(81);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
});
