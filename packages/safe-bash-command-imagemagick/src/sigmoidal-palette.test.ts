import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, including palette entries absent from the raster.
const fixtures = [
    {
        name: "transparent palette",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAMAAADO4v//AAAADFBMVEXwCiE0zFMgU+r7zSBCy93vAAAABHRSTlMowP+AOSYJWQAAAA1JREFUeJxjYGBkYgYAAA8AB4SOmW0AAAAASUVORK5CYII=",
        pixels: ["f00a212834cc53c02053eafffbcd2080", "fa071a222fe958e11958f8fffeea199b", "d80e282e38a84f9d274fcefff2a9276e"],
        cycled: ["34cc53c02053eafffbcd2080f00a2128", "2fe958e11958f8fffeea199bfa071a22", "38a84f9d274fcefff2a9276ed80e282e"]
    },
    {
        name: "ordered palette",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABAgMAAABmjvwnAAAADFBMVEUgICAoWozSoG4AAACiSI3YAAAACklEQVR4nGOQAAAAGgAZLYj0NgAAAABJRU5ErkJggg==",
        pixels: ["202020ff285a8cffd2a06eff", "191919ff2263abffedc380ff", "272727ff2e5476ffae8462ff"],
        cycled: ["285a8cffd2a06eff000000ff", "2263abffedc380ff000000ff", "2e5476ffae8462ff000000ff"]
    },
    {
        name: "unused palette entry",
        png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAABlBMVEUAAADIoIxw0g3VAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==",
        pixels: ["000000ff", "000000ff", "000000ff"],
        cycled: ["c8a08cff", "e6c3abff", "a48476ff"]
    }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const fixture of fixtures) {
        for (const [index, operation] of [[], ["-sigmoidal-contrast", "5x40%"], ["+sigmoidal-contrast", "5x40%"]].entries()) {
            it.each([false, true])(`${mode}: ${fixture.name} ${operation.join(" ")} cycle=%s`, async cycle => {
                const input = Buffer.from(fixture.png, "base64");
                const files = new Map<string, Uint8Array>([["/in.png", input]]);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/in.png", input);
                const args = ["/in.png", ...operation, ...(cycle ? ["-cycle", "1"] : []), "-depth", "8", "rgba:/out"];
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }) : mode === "sync" ? runConvertCliSync(args, files)
                    : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
                expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
                const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
                expect(Buffer.from(output).toString("hex")).toBe((cycle ? fixture.cycled : fixture.pixels)[index]);
            });
        }
    }
}
