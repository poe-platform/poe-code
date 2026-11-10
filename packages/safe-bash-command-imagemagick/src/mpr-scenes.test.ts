import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { selection: ["mpr:seq[2,0]"], scene: undefined, expected: "2/2/0;3/3/1;" },
        { selection: ["mpr:seq[2]"], scene: undefined, expected: "2/2/0;" },
        { selection: ["mpr:seq[0]"], scene: undefined, expected: "0/0/0;" },
        { selection: [], scene: undefined, expected: "0/0/0;1/1/1;2/2/2;3/3/3;" },
        { selection: ["mpr:seq[2,0]"], scene: "0", expected: "0/0/0;1/1/1;" },
        { selection: ["mpr:seq[2,0]"], scene: "7", expected: "7/7/0;8/8/1;" },
        { selection: ["mpr:seq[2]", "+delete", "mpr:seq[0]"], scene: undefined, expected: "0/0/0;" }
    ])(`retains the starting MPR scene (${mode}): $selection, scene=$scene`, async ({ selection, scene, expected }) => {
        // Default scenes match ImageMagick 7.1.2-35 Q16-HDRI.
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", files.get("out")!);
        const args = ["xc:red", "xc:lime", "xc:blue", "xc:white",
            ...(selection.length ? ["-write", "mpr:seq", "-delete", "0-3", ...selection] : []),
            ...(scene === undefined ? [] : ["-scene", scene]),
            "-format", "%s/%[scene]/%p;", "info:out"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        if ("stderr" in result) stderr = String(result.stderr);
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(new TextDecoder().decode(mode === "retained" || mode === "command"
            ? await filesystem.readFile("/out") : files.get("out"))).toBe(expected);
    });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
    it(`retains source frame delays when numbering selected MPR scenes (${mode})`, async () => {
        const files = new Map<string, Uint8Array>();
        expect(runMagickCliSync(["-delay", "4", "xc:red", "-delay", "8", "xc:lime", "-delay", "12", "xc:blue", "frames.gif"], files).exitCode).toBe(0);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/frames.gif", files.get("frames.gif")!);
        const args = ["frames.gif", "-write", "mpr:seq", "-delete", "0-2", "mpr:seq[2,0]", "-format", "%s/%T;", "info:"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "2/12;3/4;", stderr: "" });
    });
}
