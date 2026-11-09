import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// 8x8 GrayAlpha (PNG color type 4) and RGBA inputs. Expected bytes captured with
// ImageMagick 7.1.2-35 Q16-HDRI: input.png [options] -auto-gamma PNG32:out.png,
// then out.png -depth 8 rgba:-. Compare all gray/color and alpha samples.
const inputs = {
    "gray": "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAQAAABuBnYAAAAAAmJLR0QA/4ePzL8AAAAHdElNRQfqCwcXDiVd4tfQAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDIzOjE0OjM3KzAwOjAw7viRrQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QyMzoxNDozNyswMDowMJ+lKREAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMjM6MTQ6MzcrMDA6MDDIsAjOAAAATklEQVQI1z3Mqw2AUBAAweECCBAvJDg8/fdDBxRwBnEIPm6STbbb59VgcrqsLtGQSE0p8ZBSErGAtEk0vaOk3viGYFSo9xX189nGx297A38WHjPLBVGcAAAAAElFTkSuQmCC",
    "rgba": "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjM6MTQ6MzcrMDA6MDDu+JGtAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIzOjE0OjM3KzAwOjAwn6UpEQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMzoxNDozNyswMDowMMiwCM4AAABrSURBVBjTdc7BCYAwDAXQbxAkmJPk2AE6jQM4rmu4QknvIQcPYiuip8D7fPKHadnmJAoTRaoKkx1WFUkUVhWUOeAc8NJvMw7QFz4L5GV94drCzIHROY4WSiCXgEkvkPOF/vviA5+b6G/9bSf+oICXc0KZiQAAAABJRU5ErkJggg=="
} as const;
const cases: { name: string; input: keyof typeof inputs; options: string[]; expected: string }[] = [
    {
        "name": "gray default",
        "input": "gray",
        "options": [],
        "expected": "SEhIIGBgYCBlZWUgb29vIFhYWCBSUlIgaGhoIGNjYyBaWlogYGBgIFpaWiBvb28gTExMIGNjYyBnZ2cgYmJiIFpaWiBUVFQgampqIG9vbyBLS0sgYmJiIFxcXCBiYmIgbGxsIFRUVCBqamogZWVlIGlpaSBXV1cgXFxcIHFxcSBsbGzuU1NT7mBgYO5kZGTub29v7ldXV+5cXFzuZ2dn7mxsbO5aWlruX19f7mRkZO5ubm7uV1dX7lFRUe5nZ2fua2tr7llZWe5fX1/uWVlZ7m5ubu5LS0vuYmJi7mZmZu5hYWHuWVlZ7lNTU+5paWnubm5u7kpKSu5hYWHuW1tb7g=="
    },
    {
        "name": "gray -alpha off",
        "input": "gray",
        "options": [
            "-alpha",
            "off"
        ],
        "expected": "aGho/39/f/+EhIT/jo6O/3h4eP9ycnL/h4eH/4KCgv96enr/f39//3p6ev+Ojo7/bGxs/4KCgv+Ghob/gYGB/3p6ev90dHT/iYmJ/46Ojv9ra2v/gYGB/3x8fP+BgYH/i4uL/3R0dP+JiYn/hISE/4iIiP92dnb/fHx8/4+Pj/+Li4v/c3Nz/39/f/+Dg4P/jo6O/3Z2dv98fHz/hoaG/4uLi/96enr/fn5+/4ODg/+NjY3/dnZ2/3Fxcf+Ghob/ioqK/3l5ef9+fn7/eXl5/42Njf9ra2v/gYGB/4WFhf+AgID/eXl5/3Nzc/+IiIj/jY2N/2lpaf+AgID/e3t7/w=="
    },
    {
        "name": "rgba default",
        "input": "rgba",
        "options": [],
        "expected": "IjqOLFRNnyw4Xa8sYUW9LEhWjSwnPZ4sVlCtLDw0vCxjSIssS1mcLCxBrCxZUrssPziJLGVLmixOXKosMES5LFxVhyxCPJksaE6pLFFeuCw0R4UsXliXLEU/pywiUbYsVDbELDhKlSxhWqYsSEK1LCdUwyxWOpQsPE2kLGNdsyxLRcLxLFaS8Vk9ovE/ULLxZTTA8U5IkPEwWaHxXEGw8UJSv/FoOI7xUUuf8TRcr/FeRL3xRVWN8SI8nvFUTq3xOF688WFHi/FIWJzxJz+s8VZRu/E8NonxY0qa8UtaqvEsQrnxWVSH8T86mfFlTanxTl248TBFhfFcVpfxQj2n8Q=="
    },
    {
        "name": "gray -colorspace sRGB",
        "input": "gray",
        "options": [
            "-colorspace",
            "sRGB"
        ],
        "expected": "WFhYLG9vbyx1dXUsf39/LGhoaCxiYmIseHh4LHJycixqamosb29vLGpqaix/f38sXFxcLHJycix3d3cscXFxLGpqaixkZGQsenp6LH9/fyxaWloscXFxLGxsbCxxcXEsfHx8LGRkZCx6enosdXV1LHl5eSxmZmYsbGxsLICAgCx8fHzxY2Nj8W9vb/Fzc3Pxf39/8WZmZvFsbGzxd3d38Xx8fPFqamrxbm5u8XNzc/F+fn7xZmZm8WFhYfF3d3fxe3t78WlpafFubm7xaWlp8X5+fvFaWlrxcXFx8XZ2dvFwcHDxaWlp8WNjY/F5eXnxfn5+8VlZWfFwcHDxa2tr8Q=="
    }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: matches native auto-gamma weighting for $name`, async ({ input, options, expected }) => {
        const png = Buffer.from(inputs[input], "base64");
        const files = new Map<string, Uint8Array>([["input.png", png]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", png);
        const argv = ["input.png", ...options, "-auto-gamma", "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual(Array.from(Buffer.from(expected, "base64")));
    });
}
