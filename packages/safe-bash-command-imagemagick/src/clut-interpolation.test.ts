import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: source Integer changes the lookup extent;
// table Integer only changes how that extent is sampled.
for (const mode of ["map", "sync", "filesystem", "command"])
for (const beforeRead of [false, true])
for (const [source, table, global, expected] of [
    ["", "Nearest", "", "ff00000000ff0000ff"],
    ["Nearest", "", "", "ff00000000ff0000ff"],
    ["", "", "Nearest", "ff00000000ff0000ff"],
    ["", "Bilinear", "", "ff00007f00800000ff"],
    ["Bilinear", "", "", "ff00007f00800000ff"],
    ["", "", "Bilinear", "ff00007f00800000ff"],
    ["Integer", "", "", "ff00000000ff0000ff"],
    ["", "Integer", "", "ff0000ff00000000ff"],
    ["Bilinear", "Integer", "", "ff00007f00800000ff"],
    ["Integer", "Bilinear", "", "ff00000000ff0000ff"],
    ["Nearest", "Integer", "Bilinear", "ff00007f00800000ff"],
    ["Nearest", "Integer", "+interpolate", "ff00007f00800000ff"]
])
it(`${mode}, beforeRead=${beforeRead}: CLUT interpolation source=${source}, table=${table}, global=${global}`, async () => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const sourceSetting = source ? ["-interpolate", source] : [], tableSetting = table ? ["-interpolate", table] : [];
    const args = ["-respect-parentheses", "(", ...(beforeRead ? sourceSetting : []), "xc:black", "xc:#808080", "xc:white", "+append",
        ...(!beforeRead ? sourceSetting : []), ")", "(", ...(beforeRead ? tableSetting : []), "xc:red", "xc:blue", "+append",
        ...(!beforeRead ? tableSetting : []), ")", ...(global === "+interpolate" ? [global] : global ? ["-interpolate", global] : []),
        "-clut", "-depth", "8", "rgb:/out"];
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
