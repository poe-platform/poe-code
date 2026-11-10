import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

const input = new Uint8Array(Buffer.concat([
    Buffer.from("P7\nWIDTH 4\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
    Buffer.from("d02030302050e07030903060c01060e0112233508080804080a080b090102080", "hex")
]));
const keep = new TextEncoder().encode("KEEP");

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const property of [false, true])
it.each(["bad", "2oops", "2x1+35"])(`${mode}: validates motion-blur geometry %s before replacing output (property=${property})`, async geometry => {
    const files = new Map([["/in.pam", input], ["/out", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pam", input);
    await fs.writeFile("/out", keep);
    const args = ["/in.pam", ...(property ? ["-set", "option:blur", geometry] : []), "-motion-blur", property ? "%[blur]" : geometry, "-depth", "8", "rgba:/out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    stderr = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
    if (geometry === "2x1+35") {
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(Buffer.from(output).toString("hex")).toBe("a25e5e40546fa6876050286eb2104db7435255528287766c866d5e9b90102080");
    } else {
        expect(result.exitCode).toBe(1);
        expect(stderr).toContain("invalid argument for option '-motion-blur'");
        expect(stderr).toContain(geometry);
        expect(output).toEqual(keep);
    }
});

for (const retained of [false, true])
it.each(["bad", "2oops"])(`mogrify preserves input for malformed motion-blur geometry %s (retained=${retained})`, async geometry => {
    const files = new Map([["/in.pam", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.pam", input);
    const result = await runMogrifyCli(["-motion-blur", geometry, "/in.pam"], retained ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid argument for option '-motion-blur'");
    expect(retained ? await filesystem.readFile("/in.pam") : files.get("/in.pam")).toEqual(input);
});
