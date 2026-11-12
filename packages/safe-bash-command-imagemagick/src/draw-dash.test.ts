import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete 15x5 8-bit gray rasters.
const cases = [
    ["stroke-dasharray 3,2 line 1,2 13,2", "774ca8eefcb15cac737d0785355d8507308c18bcb77080e0fa0b98818697b981"],
    ["stroke-dasharray 3,2 stroke-dashoffset 1 line 1,2 13,2", "4c6a63cbc3e0b982a26ce8c2b8a82b5d616bbe55d50dade3f44ab8762eafa27d"],
    ["stroke-dashoffset 1 line 1,2 13,2", "7eb752cf85a30fe52ff5ed29c31227eec0158095d156bc9137b9b854223c5d8d"],
    ["stroke-dasharray 3,2 stroke-dasharray none line 1,2 13,2", "7eb752cf85a30fe52ff5ed29c31227eec0158095d156bc9137b9b854223c5d8d"],
    ["stroke-dasharray 3,2 polyline 1,3 8,3 8,1 13,1", "6c4c23ab171c6c20b5a5be072238252a551e0d3a8d73d451480086733fd98106"],
    ["line 1,2 13,2", "7eb752cf85a30fe52ff5ed29c31227eec0158095d156bc9137b9b854223c5d8d"],
    ["stroke-dasharray 3 line 1,2 13,2", "833f8955ad9fe5542a8d7b9e9b9a8f220eb8a8e63ed51e91482afda5f8449d71"],
    ["stroke-dasharray 3,2 stroke-dashoffset -1 line 1,2 13,2", "774ca8eefcb15cac737d0785355d8507308c18bcb77080e0fa0b98818697b981"],
    ["stroke-dasharray 3,2 stroke-dashoffset 1 push graphic-context stroke-dasharray 1,1 stroke-dashoffset 0 pop graphic-context line 1,2 13,2", "4c6a63cbc3e0b982a26ce8c2b8a82b5d616bbe55d50dade3f44ab8762eafa27d"],
    ["stroke-dasharray 3,2 polyline 1,2 6,2 13,2", "774ca8eefcb15cac737d0785355d8507308c18bcb77080e0fa0b98818697b981"],
    ["translate 1,1 stroke-dasharray 3,2 line 0,1 12,1", "774ca8eefcb15cac737d0785355d8507308c18bcb77080e0fa0b98818697b981"],
    ["scale 2,2 stroke-dasharray 1.5,1 stroke-dashoffset 0.5 line 0.5,1 6.5,1", "3747e411bd1c99d7f9b99d86c0506a6145dee1ba76d8a523021328386995fc33"],
    ["stroke-dasharray 3,2 stroke-dashoffset 3 line 1,2 13,2", "d5dfa038536214ae3e9fd1e3a3a6af650d4f2d602965b63f8885d2ab972cf46f"],
    ["stroke-dasharray 3,2 line 1,3 13,1", "b069f70d2911841c96715cd4c9fba83616b612bc753626d26854772362977f27"],
];

for (const mode of ["command", "map"] as const) {
    it.each(cases)(`${mode}: native raster for %s`, async (draw, hash) => {
        const args = ["-size", "15x5", "xc:white", "-fill", "none", "-stroke", "black", "-strokewidth", "1", "-draw", draw!, "-depth", "8", "gray:-"];
        let stdout = Buffer.alloc(0), stderr = "";
        const result = mode === "map" ? await runConvertCli(args, new Map()) : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(data) { stdout = Buffer.concat([stdout, Buffer.from(data)]); } },
            stderr: { async write(data) { stderr += new TextDecoder().decode(data); } },
        });
        expect(result.exitCode, stderr).toBe(0);
        const bytes = mode === "map" ? (result as Awaited<ReturnType<typeof runConvertCli>>).stdoutBytes! : stdout;
        expect(bytes.length).toBe(75);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    });
}

it("resets dash settings between draw options", async () => {
    const result = await runConvertCli(["-size", "15x5", "xc:white", "-fill", "none", "-stroke", "black", "-draw", "stroke-dasharray 3,2 stroke-dashoffset 1", "-draw", "line 1,2 13,2", "-depth", "8", "gray:-"], new Map());
    expect(result.exitCode).toBe(0);
    expect(createHash("sha256").update(result.stdoutBytes!).digest("hex")).toBe("7eb752cf85a30fe52ff5ed29c31227eec0158095d156bc9137b9b854223c5d8d");
});

it.each(["stroke-dasharray", "stroke-dasharray 3,0", "stroke-dasharray -1,2", "stroke-dasharray 1,Infinity", "stroke-dashoffset", "stroke-dashoffset Infinity"])("preserves output after invalid %s", async draw => {
    const fs = new MemoryFileSystem(), keep = new TextEncoder().encode("keep");
    await fs.writeFile("/out.gray", keep);
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(["-size", "15x5", "xc:white", "-stroke", "black", "-draw", `${draw} line 1,2 13,2`, "gray:out.gray"]).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    });
    expect(result.exitCode).toBe(1);
    expect(await fs.readFile("/out.gray")).toEqual(keep);
});
