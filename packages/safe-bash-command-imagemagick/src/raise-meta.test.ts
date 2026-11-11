import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync, runMagickCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const option of ["-raise", "+raise", ""])
for (const channel of ["", "Default", "Meta0", "Meta1", "R"])
for (const separated of ["Meta0", "Meta1"])
it(`shades ${separated} with ${option || "no bevel"}, selecting ${channel || "implicit default"}, ${mode}`, async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const args = ["-size", "3x3", "xc:#345caa80", "-channel-fx", "red=>meta0,green=>meta1",
        ...(channel ? ["-channel", channel] : []), ...(option ? [option, "1x1"] : []),
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
    // Native ImageMagick Q16-HDRI row-major bytes, including the untouched center.
    const selected = option && (!channel || channel === "Default" || channel === separated);
    const expected = !selected ? (separated === "Meta0" ? "34" : "5c").repeat(9)
        : separated === "Meta0" ? option === "-raise" ? "949494683427681c27" : "1c1c1c273468279468"
        : option === "-raise" ? "a9a9a9865c45863145" : "313131455c8645a986";
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
