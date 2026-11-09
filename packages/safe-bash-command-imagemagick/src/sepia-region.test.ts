import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAsAAAAJCAYAAADkZNYtAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NDg6NDkrMDA6MDDQsbn5AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjQ4OjQ5KzAwOjAwoewBRQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo0ODo0OSswMDowMPb5IJoAAAFoSURBVBjTY2bXC61ZsPn4rXeMoiv2nH/8jW/h1hO33zGJrtx74ckP7vmbzj36yim19uCVl38EFjOdOnXq1I0bN27cvn379r179+7dvXv37vv3799/+vTp09evX79++PDhAxsbGxsnJycnEw8PDw8zMzOzrKysrIKCgoKysrKymJiYmImJiYm5ubm5lZWVlaampqa3t7c3g3ZQ5YLz32RdimcdfGGd1LnhAbteaOuay7+0Aivmf5dzzZl75LWQc9bEHS8FzOMYdj/iNEjq3HCd0yC8bsP1f6rt667+0Q+rXXL9n6pP/bKzX6KbVl5g0Q6qXHvltxLT7NmzZ1+9evUqzN3r1q1b9+bNmzcwdx88ePAgMzMzMxsbGxsTJycn55UrV65ISUlJwdz9/Pnz54aGhoYwd//69euXh4eHB+Oqiz/k10PB/////29AAiwsLCwbkQCjeVzrmk1IgI+Pj28zEhAWFhbeAgUAZE/RXNTRPyoAAAAASUVORK5CYII=", "base64");
// ImageMagick 7.1.2-31 Q16-HDRI, PNG32 decoded to RGBA8.
const cases = [
    {
        "name": "region",
        "operations": [
            "-region",
            "4x3+2+2",
            "-sepia-tone",
            "65%",
            "+region"
        ],
        "rgba": "DxQUfAEBARhCVVy0FwQDUIGkxPAaIyONBAQBKllwfsc8Eg9sAAAACjVESKgUFghGgaTE8BwlJY8FBgIuX3mJzQ8UFHwBAQEcTGBqvCQJB1wAAAAQP1BXsRgFA1KDp8jzvJw0qodoCEP93nz0mnoVjhcEA1CDp8jzIi0ulgoLBDmIr9T8LDk8oBIUB0T42XXswaE5rpFyDkv/54b/Kzg6nzwSD2wAAAASR1pjuCcKCF4GBwIwaoeb135gCHj//7UX/+qI/7KSK6EZHAtMhKjK9GN9j9ANEhJ5AgICIl12hss5SU6sHQYFVgAAAAA3RkuqHSYmkAsNBDt5mbXmHicokQ8UFHwDBAEoZ4OW1BEYF4BEFRJwAQEBHVx1hMoMERF3PBIPbAEBARpacoDICxAQdkQVEnABAgEfYXqLzg8VFX0PFBR8BAUBLG+NpNwaIiKMHSYmkBARBkGCpsfyLz1AozlJTqwnCgheAAAAEFNpdcJjfY/QExoZgwkKAzZ7nbnpiK/U/D5PVbAvDQtk"
    },
    {
        "name": "clipped",
        "operations": [
            "-region",
            "4x3-2-1",
            "-sepia-tone",
            "65%",
            "+region"
        ],
        "rgba": "el0Idf//pghCVFy0FgQDUIGkxPAaIyONBAQBKlhwfsc8Eg9sAAAACjRDSKj//8Q6/N588xwlJY8FBgIuX3mJzQ8UFHwBAQEcTGBqvCQJB1wAAAAQP1BXsRgFA1KDp8jzOUlOrBUEAk6BpMTwHygpkhYEA1CDp8jzIi0ulgoLBDmIr9T8LDk7oBIUB0R6nLjoPk9VsBwGBFWHrdL6Kzg6nzwSD2wAAAASR1pjuCYKCF4GBwIwaoeb1xAWFX4DAwMliK/U/DA+QqQZHAtMhKjK9GN9jtANEhJ5AgICIl12hcs5SU6sHQYFVgAAAAA3RkuqHSYmkAsNBDt5mbTmHicnkQ8UFHwDBAEoZ4KW1BEXF4BDFRJwAQEBHVx0hMoMERF3PBIPbAEBARpacoDICxAQdkMVEnABAgEfYHqLzg8VFX0PFBR8BAUBLG+NpNwaIiKMHSYmkA8RBkGCpsfyLz1AozlJTqwmCgheAAAAEFNpdcJjfY7QExoZgwkKAzZ7nbnpiK/U/D5PVbAvDQtk"
    },
    {
        "name": "outside",
        "operations": [
            "-region",
            "4x3+20+20",
            "-sepia-tone",
            "65%",
            "+region"
        ],
        "rgba": "ExwcfAEBARhUa3W0IwYDUIWpyPAkMTCNBgYBKmeElMdcGRZsAAAACkZaYageIgxGhanI8CYzM48ICAIubYuezRMcHHwBAQEcXHaDvDcMCVwAAAAQUGdwsSYHBFKGq8vzSmBorCAFA06FqcjwKTg4kiMGA1CGq8vzLj4/lhARBTmJsNX8O01RoBwfCkSBpL/oT2ZusCoIBVWJr9P6OkxPn1wZFmwAAAASWHF8uDsOCl4JCgMwdZWs1xUeHn4EBAQlibDV/EBUWaQnLBBMh6zM9HCOotARGRl5AwMDImuImstKYGisLAkGVgAAAABIXmSqJzU1kBETBjuAor3mKDY2kRMcHHwFBQEoc5Ko1BcgIIBmHRpwAQIBHWqHmcoPFxd3XBkWbAEBARpohZbIDxYWdmYdGnACAgIfboyfzhQdHX0THBx8BgcCLHmas9wjLy+MJzU1kBgbCUGGq8ryP1JXo0pgaKw7DgpeAAAAEGJ+jMJwjqLQGiQjgw0OBDaBpcDpibDV/E9mbrBIEg9k"
    },
    {
        "name": "opaque",
        "operations": [
            "-alpha",
            "off",
            "-region",
            "4x3+2+2",
            "-sepia-tone",
            "65%",
            "+region"
        ],
        "rgba": "By5V/6PK8f8/Zo3/2wIp/3uiyf8YP2b/tdwD/1J5oP/3HkX/lbzj/zNagf/R+B//e6LJ/xpBaP+54Af/WH+m/wcuVf+nzvX/R26V/+cONf+bwun/PGOK/90EK/9+pcz/tJEg/3lYAP/923D/jWwA/9sCKf9+pcz/IUhv/8TrEv+HrtX/K1J5/8/2Hf/31Wj/uZYl/4NiAP//5Xv/KlF4//ceRf+dxOv/Q2qR/+kQN/+74gn/Yomw/29PAP///67//+h9/6iGFv/X/iX/f6bN/1uCqf8EK1L/rdT7/1Z9pP83XoX/4Qgv/4uy2f81XIP/G0Jp/8btFP9xmL//HENq/wcuVf+z2gH/X4at/wsyWf/7Ikn/qM/2/1V8o/8CKVD/9x5F/6XM8/9TeqH/AShP//siSf+q0fj/WYCn/wgvVv8HLlX/t94F/2eOtf8XPmX/G0Jp/8zzGv99pMv/LlV8/zdehf/pEDf/m8Lp/010m/9bgqn/DjVc/8HoD/90m8L/h67V/ztiif/vFj3/"
    },
    {
        "name": "plain",
        "operations": [
            "-sepia-tone",
            "65%"
        ],
        "rgba": "KAYALP//dgCYaACJOhQAAPrLNexGHwBI//91AL6NAKhyRQAR//NfAH5QAHX//6QA+ss17EoiAEv//3wAyZgAsigGACz//30AqHgAllEoAAD//WkAkWIAhD4XAAD9zznxh1gAezYRAAD6yzXsUCcAUDoUAAD9zznxWC4AV///jgD/3Ej/bUEAZ///oQDxwijfj2AAgkMcAAD/2UT9az8AZnJFABH//2wAoHAAj1UrAAD//38A2qkLwysIAC///4wA/9xI/3VIAG7//64A/tA7886dALcjAgAn//+HAMWUAK+HWAB7RR4AAP/jTgCCVAB4TCQATf//kgDvvyXcTiUATygGACz//3IA1aQGvi8LADJ7TQAY//9/AMOSAK0gAAAjckUAEf//egDAjwCqHgAAIntNABj//4IAy5oAtCoHAC0oBgAs//95AOGxFMtEHQBGTCQATf//nAD8zjjwc0cAbIdYAHtVKwAA//1pALSDAKDOnQC3NA8AN///iQDzwyrh/9xI/49gAIJhNgAE"
    }
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`matches every sepia pixel: $name, ${mode}`, async ({ operations, rgba }) => {
        const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", ...operations, "PNG32:out.png"];
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
        expect([output.width, output.height]).toEqual([11, 9]);
        expect([...output.data]).toEqual([...Buffer.from(rgba, "base64")]);
    });
}

for (const retained of [false, true]) {
    it(`keeps global region coordinates across sepia storage chunks (retained=${retained})`, async () => {
        const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", "-duplicate", "60", "+append", "-region", "400x3+200+2", "-sepia-tone", "65%", "+region", "PNG32:out.png"];
        const result = await runConvertCli(args, retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([671, 9]);
        // Digest of every native RGBA8 sample, including protected pixels.
        expect(createHash("sha256").update(output.data).digest("hex")).toBe("50b1cc3793c51fbabe1bfbd974fd59dd32a038f317abfe684f70a0ec30fb07ac");
    });
}
