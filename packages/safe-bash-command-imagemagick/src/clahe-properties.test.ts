import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["public", "map"])
it.each([
    ["2x2+16+2", "2x2+16+2", 0, "9b6e3a60b2ffffa0cface0ea"],
    ["2x2+16+2", "%[option:g]", 0, "9b6e3a60b2ffffa0cface0ea"],
    ["2x2+16+2", "bad", 1, "4b454550"],
    ["bad", "%[option:g]", 1, "4b454550"],
])(`expands CLAHE option properties (%s, %s, mode=${mode})`, async (value, operand, exitCode, expected) => {
    const argv = ["xc:#80562360", "xc:#40a0a0a0", "xc:#9070a0ea", "+append",
        "-set", "option:g", value, "-clahe", operand, "-depth", "8", "rgba:out"];
    const files = new Map([["out", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", Buffer.from("KEEP"));
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "map" ? await runMagickCli(argv, files) : await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
    });
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(exitCode);
    expect(Buffer.from(mode === "map" ? files.get("out")! : await fs.readFile("/out")).toString("hex")).toBe(expected);
    if (exitCode === 0) expect(stderr).toBe("");
    else expect(stderr).toContain("Invalid CLAHE geometry");
});
