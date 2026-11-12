import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

const rectangleHash = "fe4efbd1cb646d86741c7b0df42bf130843e8404cdb83956f584b628a2dba81b";
for (const mode of ["map", "filesystem", "command"])
for (const [drawing, hash] of [
    ["path 'M1,0H4V2H1Z'", rectangleHash],
    ["polygon 1,0 4,0 4,2 1,2", rectangleHash],
    ["point 1,1", "82d453931561cbbcf1e7b8a799b10dfb177872c72b0aaf21582359948c325257"],
    ["rectangle 1,0 4,2", rectangleHash],
    ["path 'M1,0H4V2H1Z' fill red point 2,1", rectangleHash],
    ["translate 1,0 path 'M0,0H3V2H0Z'", rectangleHash],
    ["translate 1,0 point 0,1", "82d453931561cbbcf1e7b8a799b10dfb177872c72b0aaf21582359948c325257"],
    ["push graphic-context fill red point 0,1 pop graphic-context polygon 1,0 4,0 4,2 1,2", "fc32ad01e409931f7edf68e304689508977891ffcd9ca38c89f32403284aba7a"],
    ["circle 2,1 3,1", "37331300392d5412fabc9928fd0ad098eef297da38bcb5c085171882fd327532"],
    ["fill red path 'M1,0H4V2H1Z'", "aa0e2fadf1310c077dbad8ba21c0c737f1aa44648239d7702f237ebdc57050ca"],
]) it(`matches native tile drawing: ${mode}, ${drawing}`, async () => {
    const args = ["xc:red", "xc:blue", "+append", "-write", "tile.miff", "+delete", "-size", "6x3", "xc:white", "-tile", "tile.miff", "-draw", drawing!, "-depth", "8", "rgb:out.rgb"];
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const argumentValues = createCommandArguments(args);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}, fs,
    } as unknown as CommandContext;
    const result = mode === "command" ? await createMagickCommand().execute(context)
        : await runConvertCli(args, mode === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = mode === "map" ? files.get("out.rgb")! : await fs.readFile("/out.rgb");
    expect(bytes.length).toBe(54);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
});
