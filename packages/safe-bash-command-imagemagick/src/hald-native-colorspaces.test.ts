import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./hald-native-colorspaces-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2-31 Q16-HDRI: magick hald:2 -colorspace SPACE miff:cube.miff.
// Each reader receives the identical native MIFF, independently of our Hald generator.
for (const mode of ["buffered", "retained", "sync", "command"] as const)
for (const fixture of fixtures)
for (const output of ["rgba", "channels", "info"] as const)
it(`${mode}: native ${fixture.space} Hald ${output}`, async () => {
    const files = new Map([["/cube.miff", Buffer.from(fixture.miff, "base64")]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/cube.miff", files.get("/cube.miff")!);
    const tail = output === "info" ? ["-format", "%[pixel:p{0,0}]", "info:/out"]
        : [...(output === "channels" ? ["-channel", "RGB", "-separate"] : []), "-endian", "MSB", "-depth", "16", `${output === "rgba" ? "rgba" : "gray"}:/out`];
    const args = ["xc:#4287ba83", "miff:/cube.miff", "-hald-clut", ...tail];
    if (mode === "command") {
        const values = createCommandArguments(args);
        let stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: values.args, argumentValues: values, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        })).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
    } else {
        expect(mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
    const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(output === "info" ? "utf8" : "hex")).toBe(fixture[output]);
});
