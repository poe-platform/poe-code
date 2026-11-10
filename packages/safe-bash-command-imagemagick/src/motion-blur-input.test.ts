import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

it.each(["buffered", "sync", "retained", "magick", "convert"] as const)("requires a current image for motion blur and preserves the destination on failure (%s)", async mode => {
    const input = Buffer.concat([
        Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
        Buffer.from("d02030302050e07030903060c01060e0112233508080804080a080b090102080", "hex")
    ]);
    const original = new TextEncoder().encode("KEEP");
    const blurred = Buffer.from("a25e5e40546fa6876050286eb2104db7435255528287766c866d5e9b90102080", "hex");
    for (const prefix of [[], ["in.pam", "+delete"], ["in.pam"]]) {
        const valid = prefix.length === 1;
        const files = new Map<string, Uint8Array>([["in.pam", input], ["out", original]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = [...prefix, "-motion-blur", "2x1+35", ...valid ? [] : ["in.pam"], "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(valid ? 0 : 1);
        expect.soft(result.stdout).toBe("");
        expect.soft(result.stderr).toBe(valid ? "" : "magick: no images found for operation '-motion-blur'\n");
        expect.soft(mode === "buffered" || mode === "sync" ? files.get("out") : await fs.readFile("/out")).toEqual(Uint8Array.from(valid ? blurred : original));
    }
});
