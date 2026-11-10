import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: PNG32 output decoded with native -depth 8 rgba:-.
const opaque = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAI0lEQVQI12MQdMj/f/aP9v/OHc//u5Ys/s/04cMHBmSMIQAANMIguXNqsNIAAAAASUVORK5CYII=";
const translucent = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAALUlEQVQI12MWdMgPOHrni7my1SV7RgkDN5YPHz7YfPjwgR+GWT58+GCzB0kAAJWLHQP28vImAAAAAElFTkSuQmCC";
const cases = [
    { name: "opaque region", input: opaque, operations: ["-region", "2x2+1+0", "-blur", "0x1", "+region"],
        rgba: "11406fff79a86aff77a69cff4574a3ff01305fff83b24eff709fa4ff356493fff1204fffaddc0bff6998c7ff255483ff" },
    { name: "opaque control", input: opaque, operations: ["-blur", "0x1"],
        rgba: "4c6f60ff79a36fff78a697ff5786a6ff6c6556ff829965ff729c8dff4e7c9cffa75b4cff968f5bff6e9283ff447292ff" },
    { name: "opaque reset", input: opaque, operations: ["-region", "2x2+1+0", "+region", "-blur", "0x1"],
        rgba: "4c6f60ff79a36fff78a697ff5786a6ff6c6556ff829965ff729c8dff4e7c9cffa75b4cff968f5bff6e9283ff447292ff" },
    { name: "translucent region", input: translucent, operations: ["-region", "2x2+1+0", "-blur", "0x1", "+region"],
        rgba: "122235507eab697673a29f833154757d1c26468c89b3499c6c9ba7a9305a85b9d82049c8a4d00ed76795c2e6255482f5" },
    { name: "translucent control", input: translucent, operations: ["-blur", "0x1"],
        rgba: "58715d6c7da3717673a098835381a48e816552928898659c6d968ca9497799b3b35c4ab7988f5cc26b8e84cf416f90d9" },
    { name: "translucent reset", input: translucent, operations: ["-region", "2x2+1+0", "+region", "-blur", "0x1"],
        rgba: "58715d6c7da3717673a098835381a48e816552928898659c6d968ca9497799b3b35c4ab7988f5cc26b8e84cf416f90d9" },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each(cases)(`matches native blur pixels (${mode}, $name)`, async ({ input, operations, rgba }) => {
    const png = Buffer.from(input, "base64");
    const files = new Map([["/input.png", png]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", png);
    const tokens = ["/input.png", ...operations, "PNG32:/out.png"];
    if (mode === "command") {
        const args = createCommandArguments(tokens);
        let stderr = "";
        expect(await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        })).toMatchObject({ exitCode: 0 });
        expect(stderr).toBe("");
    } else {
        const result = mode === "sync" ? runConvertCliSync(tokens, files)
            : await runConvertCli(tokens, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    }
    const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([4, 3]);
    expect(Buffer.from(output.data).toString("hex")).toBe(rgba);
});
