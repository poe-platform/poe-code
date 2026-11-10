import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const mode of ["public", "map"])
it.each([
    ["2x1", "2x1", 0, "303860ff303860ff989050ff989050ff"],
    ["2x1", "%[option:n]", 0, "303860ff303860ff989050ff989050ff"],
    ["1x0", "%[option:n]", 0, "202040ff405080ff808060ffb0a040ff"],
    ["2x1", "bad", 1, "4b454550"],
    ["bad", "%[option:n]", 1, "4b454550"],
])(`expands kmeans option properties (%s, %s, mode=${mode})`, async (value, operand, exitCode, expected) => {
    const argv = ["-seed", "7", "xc:#202040", "xc:#405080", "xc:#808060", "xc:#b0a040", "+append",
        "-set", "option:n", value, "-kmeans", operand, "-depth", "8", "rgba:out"];
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
    else expect(stderr).toContain("Invalid kmeans geometry");
});
