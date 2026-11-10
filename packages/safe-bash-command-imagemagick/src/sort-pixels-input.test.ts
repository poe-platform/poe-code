import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

it.each(["buffered", "sync", "retained", "magick", "convert"] as const)("requires a current image for sort-pixels (%s)", async mode => {
    const input = Uint8Array.from([
        ...new TextEncoder().encode("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
        ...Buffer.from("d02030302050e000d0203030608040f01122330080808070808080e090102080", "hex")
    ]);
    const original = new TextEncoder().encode("KEEP");
    for (const prefix of [[], ["in.pam", "+delete"], ["in.pam"]]) {
        const valid = prefix.length === 1;
        const files = new Map([["in.pam", input], ["out", original]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = [...prefix, "-sort-pixels", ...valid ? [] : ["in.pam"], "-depth", "8", "rgba:out"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect.soft(result.exitCode).toBe(valid ? 0 : 1);
        expect.soft(result.stdout).toBe("");
        expect.soft(result.stderr).toBe(valid ? "" : "magick: no images found for operation '-sort-pixels'\n");
        const output = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
        expect.soft(Buffer.from(output).toString("hex")).toBe(valid
            ? "d0203030d02030302050e000608040f0112233009010208080808070808080e0"
            : "4b454550");
    }
});
