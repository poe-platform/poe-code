import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { settings: ["-set", "option:n", "2"], value: "%[option:n]", after: [], valid: true },
        { settings: ["-set", "option:n", "2"], value: "2", after: [], valid: true },
        { settings: ["-set", "option:n", "2"], value: "%[option:n]", after: ["+remap"], valid: true },
        { settings: [], value: "bad", after: [], valid: false },
        { settings: ["-set", "option:n", "bad"], value: "%[option:n]", after: [], valid: false },
        { settings: ["-set", "option:n", "2"], value: "%[option:n]", after: ["-set", "option:n", "5"], valid: true }
    ])(`${mode} resolves -colors $value with $settings before $after`, async ({ settings, value, after, valid }) => {
        const keep = Buffer.from("KEEP"), files = new Map<string, Uint8Array>([["/out", keep]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", keep);
        const destination = mode === "buffered" || mode === "sync" ? "/out" : "out";
        const args = ["xc:#b03010", "xc:#302010", "xc:#505080", "xc:#a07070", "xc:#d0d020", "+append",
            ...settings, "+dither", "-colors", value, ...after,
            ...(valid ? ["-depth", "8", `rgba:${destination}`] : ["-format", "%r|%k", `info:${destination}`])];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        if ("stderr" in result) stderr += result.stderr;
        expect(result.exitCode, stderr).toBe(valid ? 0 : 1);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        // ImageMagick 7.1.2-35 Q16-HDRI: exact RGBA8 output, or unchanged destination on failure.
        expect(Buffer.from(output).toString("hex")).toBe(valid ? "a85040ff706b3bff706b3bffa85040ffa85040ff" : "4b454550");
        if (valid) expect(stderr).toBe("");
        else expect(stderr).not.toBe("");
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`${mode} carries the resolved color limit into a later shared palette`, async () => {
        const outputs: Uint8Array[] = [];
        for (const value of ["2", "%[option:n]"]) {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["xc:#b03010", "xc:#302010", "xc:#505080", "xc:#a07070", "xc:#d0d020", "+append",
                "-set", "option:n", "2", "+dither", "-colors", value, "-set", "option:n", "5",
                "xc:blue", "+remap", "+append", "-depth", "8", "rgba:/out"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            outputs.push(mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!);
        }
        expect(outputs[1]).toEqual(outputs[0]);
    });
}
