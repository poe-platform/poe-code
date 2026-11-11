import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAsAAAAJCAYAAADkZNYtAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NDg6NDkrMDA6MDDQsbn5AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjQ4OjQ5KzAwOjAwoewBRQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo0ODo0OSswMDowMPb5IJoAAAFoSURBVBjTY2bXC61ZsPn4rXeMoiv2nH/8jW/h1hO33zGJrtx74ckP7vmbzj36yim19uCVl38EFjOdOnXq1I0bN27cvn379r179+7dvXv37vv3799/+vTp09evX79++PDhAxsbGxsnJycnEw8PDw8zMzOzrKysrIKCgoKysrKymJiYmImJiYm5ubm5lZWVlaampqa3t7c3g3ZQ5YLz32RdimcdfGGd1LnhAbteaOuay7+0Aivmf5dzzZl75LWQc9bEHS8FzOMYdj/iNEjq3HCd0yC8bsP1f6rt667+0Q+rXXL9n6pP/bKzX6KbVl5g0Q6qXHvltxLT7NmzZ1+9evUqzN3r1q1b9+bNmzcwdx88ePAgMzMzMxsbGxsTJycn55UrV65ISUlJwdz9/Pnz54aGhoYwd//69euXh4eHB+Oqiz/k10PB/////29AAiwsLCwbkQCjeVzrmk1IgI+Pj28zEhAWFhbeAgUAZE/RXNTRPyoAAAAASUVORK5CYII=", "base64");
// ImageMagick 7.1.2-35 Q16-HDRI: input.png -blue-shift STRENGTH PNG32:out.png,
// then out.png -depth 8 rgba:-. These cover every pixel of the 11x9 translucent input.
const cases = [
    {
        "strength": "1.5",
        "rgba": "444e587cffffff18919ba5b4dca6af50e4edf7f05c656f8dd3dda72aabb5bfc7ffccd66cffffff0a818a94a8faffcd46e4edf7f05e68728fd9e3ac2eb4bdc7cd444e587cffffff1c9ca6b0bcecb6c05cffffff108d97a1b1dfa8b252e8f2fbf386909aacd9a3ad4ee4edf7f0626c7692dca6af50e8f2fbf368727b96e8f2bc39f4fefffc767f89a0f7ffcb44d9e2ece88c959fb0e3acb655f1fbfffa747e889fffccd66cffffff1297a0aab8efb9c35edce5af30c1cbd5d747515a7effffff25f4fefffc7b858fa4ffffd64ce9f3fdf4b8c1cbd0404a5479ffffff22b1bbc4cb86909aace4aeb856faffff00838d97aa60697390ebf5be3bd6e0e9e6616b7591444e587cd1daa428bdc7d1d44a535d80ffd2db70ffffff1dafb9c3ca3d475177ffccd66cffffff1aadb6c0c83c464f76ffd2db70ffffff1fb5bfc8ce464f597d444e587cd6e0aa2cc8d2dcdc5a646e8c60697390f3fdc741e6f0faf27a848da386909aacefb9c35effffff10a4aeb8c2b8c1cbd04e586183e4eeb736dae4eee9f4fefffc8c959fb0f7c1cb64"
    },
    {
        "strength": "0.75",
        "rgba": "232d367ca2abb518505a64b489535d50818b95f0313b448d808a542a606a73c7a06a746c96a0aa0a47505aa897a16b46818b95f0323c468f848d572e656f78cd232d367ca5afb81c57616abc935d675c9ba5af104e5862b18b555e52848d97f34a545dac88515b4e818b95f0353f489289535d50848d97f338424c968d9660398b959efc404a54a0959f69447b848ee84d5761b08d57615589939dfa3f49539fa06a746c9da7b012545d67b8955e685e858f59306d7780d7252e387eacb6c0258b959efc434d57a49ca66f4c848e98f467717bd0212a3479aab4bd22636d77cb4a545dac8e5862568e98a20048525caa333d47908e98623b79838de6343e4891232d367c7f8852286a747ed426303a80a36d7770a6b0b91d626c76ca1f293277a06a746ca3adb71a616a74c81e283276a36d7770a7b1bb1f666f79ce242e377d232d367c828c552c717b84dc303a438c333d4790939d6741838d96f2434c56a34a545dac955e685e9ba5af105c666fc267717bd029323c838a945e367c858fe98b959efc4d5761b09a636d64"
    }
];

for (const mode of ["buffered", "sync", "retained", "command", "mogrify"] as const)
it.each(cases)(`matches native blue shift $strength and preserves alpha (${mode})`, async ({ strength, rgba }) => {
    const files = new Map([["input.png", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = ["input.png", "-blue-shift", strength, "PNG32:out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : mode === "mogrify" ? await runMogrifyCli(["-blue-shift", strength, "input.png"], { filesystem: fs, cwd: "/" })
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const output = mode === "sync" || mode === "buffered" ? files.get("out.png")!
        : await fs.readFile(mode === "mogrify" ? "/input.png" : "/out.png");
    const decoded = decodeImage(output);
    expect([decoded.width, decoded.height]).toEqual([11, 9]);
    expect(Buffer.from(decoded.data).toString("hex")).toBe(rgba);
});

// Native Q16-HDRI, PNG64 input/output, including non-byte-aligned alpha samples.
for (const mode of ["buffered", "sync", "retained"] as const)
it(`preserves 16-bit blue-shift precision (${mode})`, async () => {
    const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDlUMTY6MTY6MjMrMDA6MDCTJAV+AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA5VDE2OjE2OjIzKzAwOjAw4nm9wgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOVQxNjoxNjoyMyswMDowMLVsnB0AAAAaSURBVAjXYxAyCauYtcdZ8d+dXTPKQlafBQA8Wwg9SUU6XAAAAABJRU5ErkJggg==", "base64");
    const files = new Map([["input.png", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = ["input.png", "-blue-shift", "0.75", "PNG64:out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, result.stderr).toBe(0);
    const output = mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
    expect(Array.from(decodeImage(output).data16 ?? [])).toEqual([16893, 21262, 25631, 17185, 46457, 42088, 37719, 43981]);
});

for (const mode of ["sync", "command"] as const)
it.each(["", "bogus", "1.5junk", "Infinity", "1.5+1", "1.5-1", "2+1"])(`rejects invalid blue-shift factor %s without replacing output (${mode})`, async factor => {
    const files = new Map([["input.png", input], ["out.png", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    await fs.writeFile("/out.png", input);
    const args = ["input.png", "-blue-shift", factor, "out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
        : await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        });
    expect(result.exitCode).toBe(1);
    const output = mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png");
    expect([...output]).toEqual([...input]);
});
