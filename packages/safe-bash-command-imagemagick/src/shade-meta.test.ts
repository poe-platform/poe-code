import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const uniform of [true, false])
for (const channel of ["", "Default", "Meta0", "Meta1", "R"])
for (const separated of ["Meta0", "Meta1"])
it(`writes shade to ${separated}, selecting ${channel || "implicit default"}, uniform=${uniform}, ${mode}`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["xc:#345caa80", ...(uniform ? [] : ["xc:#cf7822ff", "xc:#3a456100", "+append"]),
        "-channel-fx", "red=>meta0,green=>meta1", ...(channel ? ["-channel", channel] : []), "-shade", "30x40",
        "-channel", separated, "-separate", "-depth", "8", "gray:out"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out")!;
    // Native ImageMagick 7.1.2-35 Q16-HDRI, including untouched extra planes.
    const selected = !channel || channel === "Default" || channel === separated;
    const expected = selected ? uniform ? "a4" : "75b7d5"
        : separated === "Meta0" ? uniform ? "34" : "34cf3a" : uniform ? "5c" : "5c7845";
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
