import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync", "retained"] as const)
for (const depth of [8, 16])
it.each([
    [[], "00ffff"],
    [["-channel", "Meta0"], "00ffff"],
    [["-channel", "Default"], "00ffff"],
    [["-channel", "R"], "2080c0"],
    [["-alpha", "off"], "0060c0"],
    [["-channel", "A", "-evaluate", "set", "0", "+channel"], "000000"],
    [null, "2080c0"],
] as const)(`edge filters selected extra channels: %j (${mode}, depth=${depth})`, async (selection, expected) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["-size", "3x1", "xc:#404040", "-duplicate", "3", "(", "+size", "xc:#202020", "xc:#808080", "xc:#c0c0c0", "+append", ")", "-combine",
        ...(selection === null ? [] : [...selection, "-edge", "1"]),
        "+channel", "-channel", "Meta0", "-separate", "+channel", "-depth", String(depth), "gray:/out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    // Native ImageMagick 7.1.2-35 Q16-HDRI, selected extra channels and unselected-channel preservation.
    expect(Buffer.from(output).toString("hex")).toBe(depth === 8 ? expected : [expected.slice(0, 2), expected.slice(2, 4), expected.slice(4, 6)].map(byte => byte + byte).join(""));
});
