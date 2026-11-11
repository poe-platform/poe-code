import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI discards disassociated alpha during blur.
for (const input of ["canvas", "pam"] as const)
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { alpha: "disassociate", blur: false, expected: "0.501961" },
    { alpha: "disassociate", blur: true, expected: "0" },
    { alpha: "deactivate", blur: true, expected: "0.501961" },
    { alpha: "off", blur: true, expected: "0" },
    { alpha: "on", blur: true, expected: "0.501961" }
])(`${mode}/${input}: reactivates $alpha alpha after rotational blur=$blur`, async ({ alpha, blur, expected }) => {
    const argv = [...(input === "canvas" ? ["-size", "5x3", "xc:#20406080"] : ["/in.pam"]), "-alpha", alpha,
        ...(blur ? ["-rotational-blur", "130"] : []),
        "-alpha", "activate", "-format", "%[fx:p{2,1}.a]", "info:"];
    const pixels = Buffer.concat([Buffer.from("P7\nWIDTH 5\nHEIGHT 3\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"),
        Buffer.from("20406080".repeat(15), "hex")]);
    const files = new Map([["/in.pam", pixels]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pam", pixels);
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdout" in result ? result.stdout : stdout).toBe(expected);
});
