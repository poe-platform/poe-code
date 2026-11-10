import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Opaque 4×3 RGB input and full RGBA results from native ImageMagick 7.1.2 Q16-HDRI.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFklEQVR4nGNk4AoQYfwPQSwBLH+wcwDgmQy4H07nKQAAAABJRU5ErkJggg==", "base64");
const cases = [
    {
        "operations": [
            "-region",
            "2x1+2+1",
            "-roll",
            "+1+0",
            "+region"
        ],
        "rgba": "AApQ/xQLT/8oDE7/PA1N/1AOTP9kD0v/ZA9L/3gQSv+gEkj/tBNH/8gURv/cFUX/"
    },
    {
        "operations": [
            "-region",
            "2x1+2+1",
            "-roll",
            "+1+0",
            "-negate",
            "+region"
        ],
        "rgba": "AApQ/xQLT/8oDE7/PA1N/6/xs/9kD0v/ZA9L/4fvtf+gEkj/tBNH/8gURv/cFUX/"
    },
    {
        "operations": [
            "-region",
            "2x2+1+0",
            "-roll",
            "+1+1",
            "+region"
        ],
        "rgba": "AApQ/6ASSP+0E0f/PA1N/1AOTP8AClD/FAtP/4wRSf+gEkj/tBNH/8gURv/cFUX/"
    },
    {
        "operations": [
            "-region",
            "2x2+1+0",
            "-roll",
            "+1+1",
            "-negate",
            "+region"
        ],
        "rgba": "AApQ/6ASSP+0E0f/PA1N/1AOTP8AClD/6/Sw/3Putv+gEkj/tBNH/zfruf8j6rr/"
    },
    {
        "operations": [
            "-region",
            "2x2+0+0",
            "-roll",
            "-1-1",
            "+region"
        ],
        "rgba": "ZA9L/3gQSv8oDE7/PA1N/7QTR//IFEb/eBBK/4wRSf+gEkj/tBNH/8gURv/cFUX/"
    },
    {
        "operations": [
            "-region",
            "2x2+0+0",
            "-roll",
            "-1-1",
            "-negate",
            "+region"
        ],
        "rgba": "m/C0/3gQSv8oDE7/w/Ky/7QTR//IFEb/eBBK/4wRSf9f7bf/tBNH/8gURv8j6rr/"
    },
    {
        "operations": [
            "-region",
            "2x2-1+0",
            "-roll",
            "+5+4",
            "+region"
        ],
        "rgba": "3BVF/xQLT/8oDE7/PA1N/zwNTf9kD0v/eBBK/4wRSf+gEkj/tBNH/8gURv/cFUX/"
    },
    {
        "operations": [
            "-region",
            "2x2-1+0",
            "-roll",
            "+5+4",
            "-negate",
            "+region"
        ],
        "rgba": "3BVF/xQLT/8oDE7/PA1N/zwNTf+b8LT/eBBK/4wRSf+gEkj/S+y4/8gURv/cFUX/"
    },
    {
        "operations": [
            "-region",
            "2x2+2+1",
            "-roll",
            "+1+1",
            "-roll",
            "-1-1",
            "-negate",
            "+region"
        ],
        "rgba": "ZA9L/xQLT/8oDE7/UA5M/1AOTP9kD0v/6/Sw/9fzsf8UC0//tBNH/5vwtP//9a//"
    },
    {
        "operations": [
            "-region",
            "2x2+2+1",
            "-roll",
            "+1+1",
            "-blur",
            "0x1",
            "+region"
        ],
        "rgba": "IwxO/xQLT/8oDE7/Ng1N/1AOTP9kD0v/FAtP/ygMTv+DEUn/tBNH/2QPS/9gD0v/"
    },
    {
        "operations": [
            "-region",
            "2x2+2+1",
            "-roll",
            "+1+1",
            "-negate"
        ],
        "rgba": "//WvABQLT/8oDE7/w/KyAFAOTP9kD0v/FAtP/ygMTv9f7bcAtBNH/2QPS/+H77UA"
    }
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`matches every native regional roll pixel: $operations, ${mode}`, async ({ operations, rgba }) => {
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        files.set("out.png", Buffer.from("KEEP"));
        await filesystem.writeFile("/out.png", Buffer.from("KEEP"));
        const args = ["input.png", ...operations, "PNG32:out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([4, 3]);
        expect([...output.data]).toEqual([...Buffer.from(rgba, "base64")]);
    });
}
