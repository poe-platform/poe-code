import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// The original 7x5 translucent PNG, kept byte-for-byte for the regional roll regression.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAYAAACJmvbYAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcWARyEvSkgAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDIyOjAxOjE2KzAwOjAw8JtQZQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QyMjowMToxNiswMDowMIHG6NkAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMjI6MDE6MjgrMDA6MDAIY7W4AAAALUlEQVQI12NkledvENcXZsCGWRZ6tmJKeEJoRveNkjh1Mr74NQ+3ZKezMk5JAEqmErOZcmwmAAAAAElFTkSuQmCC", "base64");

// Full RGBA rasters from ImageMagick 7.1.2-35 Q16-HDRI, writing PNG32 then decoding at depth 8.
const cases = [
    {
        name: "regional",
        operations: ["-region", "4x3+1+1", "-roll", "+1+1", "+region"],
        rgba: "ByctgDA4GoBCWyiAU382gGSiRYB1RVOAhyhhgHdCa4AFHw+AHE4igDN9NYBKrEiAJWCRgDZEH4AweQ6ApmiUgL2Xp4DUxrqA6/XNgF5XdIBve4OAqbBygEexGYBe4CyAdQ8/gIw+UoBWjpiAaDEmgGEnFoCKeEOAnFtRgG1+X4B+om2Aj0V8gCBoioA=",
    },
    {
        name: "unmasked",
        operations: ["-roll", "+1+1"],
        rgba: "E12VgIlDI4CgcjaAt6FJgM7QXIDl/2+A/C6CgI85gYAFHw+AHE4igDN9NYBKrEiAYdtbgHgKboAwggaApmiUgL2Xp4DUxrqA6/XNgAIk4IAZU/OA0cuLgEexGYBe4CyAdQ8/gIw+UoCjbWWAupx4gHIUEIDo+p6A/ymxgBZYxIAth9eARLbqgFvl/YA=",
    },
    {
        name: "no operation",
        operations: ["-region", "4x3+1+1", "+region"],
        rgba: "BR8PgBxOIoAzfTWASqxIgGHbW4B4Cm6AjzmBgKZolIC9l6eA1Ma6gOv1zYACJOCAGVPzgDCCBoBHsRmAXuAsgHUPP4CMPlKAo21lgLqceIDRy4uA6PqegP8psYAWWMSALYfXgES26oBb5f2AchQQgIlDI4CgcjaAt6FJgM7QXIDl/2+A/C6CgBNdlYA=",
    },
    {
        name: "disabled alpha",
        operations: ["-alpha", "off", "-region", "4x3+1+1", "-roll", "+1+1", "+region"],
        rgba: "BR8P/xxOIv8zfTX/SqxI/2HbW/94Cm7/jzmB/6ZolP8FHw//HE4i/zN9Nf9KrEj/GVPz/zCCBv9HsRn/pmiU/72Xp//Uxrr/6/XN/7qceP/Ry4v/6Pqe/0exGf9e4Cz/dQ8//4w+Uv9b5f3/chQQ/4lDI/+gcjb/t6FJ/87QXP/l/2///C6C/xNdlf8=",
    },
    {
        name: "disabled alpha with red channel only",
        operations: ["-alpha", "off", "-channel", "R", "-region", "4x3+1+1", "-roll", "+1+1", "+region"],
        rgba: "BV2V/xxDI/8zcjb/SqFJ/2HQXP94/2//jy6C/6Y5gf8FHw//HE4i/zN9Nf9KrEj/Gdtb/zAKbv9Hggb/pmiU/72Xp//Uxrr/6/XN/7ok4P/RU/P/6MuL/0exGf9e4Cz/dQ8//4w+Uv9bbWX/cpx4/4kUEP+g+p7/tymx/85YxP/lh9f//Lbq/xPl/f8=",
    },
    {
        name: "deactivated alpha",
        operations: ["-alpha", "deactivate", "-region", "4x3+1+1", "-roll", "+1+1", "+region"],
        rgba: "Byct/zA4Gv9CWyj/U382/2SiRf91RVP/hyhh/3dCa/8FHw//HE4i/zN9Nf9KrEj/JWCR/zZEH/8weQ7/pmiU/72Xp//Uxrr/6/XN/15XdP9ve4P/qbBy/0exGf9e4Cz/dQ8//4w+Uv9Wjpj/aDEm/2EnFv+KeEP/nFtR/21+X/9+om3/j0V8/yBoiv8=",
    },
    {
        name: "copied alpha",
        operations: ["-alpha", "copy", "-region", "4x3+1+1", "-roll", "+1+1", "+region"],
        rgba: "Bh4s/ycjEf9BUyX/XI09/3PLVv/Iy2n/bh5K/2Y7W/8FHw//HE4i/zN9Nf9KrEj/N4Z7/x82Df8wew//pmiU/72Xp//Uxrr/6/XN/3VkWf+lpX7/5PSb/0exGf9e4Cz/dQ8//4w+Uv9YwNL/dFZC/zcXDf+/smj/lmpH/6KpVv/Y827/elmN/zeZuP8=",
    },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`matches every native regional roll pixel: $name, ${mode}`, async ({ operations, rgba }) => {
        const files = new Map([["half.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/half.png", input);
        const args = ["half.png", ...operations, "PNG32:out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([7, 5]);
        expect([...output.data]).toEqual([...Buffer.from(rgba, "base64")]);
    });
}
