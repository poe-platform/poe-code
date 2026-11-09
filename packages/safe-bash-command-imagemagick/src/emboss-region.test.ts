import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAsAAAAJCAYAAADkZNYtAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NDc6MTkrMDA6MDBpWuwQAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjQ3OjE5KzAwOjAwGAdUrAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo0NzoxOSswMDowME8SdXMAAAFoSURBVBjTY2bXC61ZsPn4rXeMoiv2nH/8jW/h1hO33zGJrtx74ckP7vmbzj36yim19uCVl38EFjOdOnXq1I0bN27cvn379r179+7dvXv37vv3799/+vTp09evX79++PDhAxsbGxsnJycnEw8PDw8zMzOzrKysrIKCgoKysrKymJiYmImJiYm5ubm5lZWVlaampqa3t7c3g3ZQ5YLz32RdimcdfGGd1LnhAbteaOuay7+0Aivmf5dzzZl75LWQc9bEHS8FzOMYdj/iNEjq3HCd0yC8bsP1f6rt667+0Q+rXXL9n6pP/bKzX6KbVl5g0Q6qXHvltxLT7NmzZ1+9evUqzN3r1q1b9+bNmzcwdx88ePAgMzMzMxsbGxsTJycn55UrV65ISUlJwdz9/Pnz54aGhoYwd//69euXh4eHB+Oqiz/k10PB/////29AAiwsLCwbkQCjeVzrmk1IgI+Pj28zEhAWFhbeAgUAZE/RXNTRPyoAAAAASUVORK5CYII=", "base64");
// ImageMagick 7.1.2-31 Q16-HDRI, PNG32 decoded to RGBA8.
const cases = [
    {
        "name": "region",
        "operations": [
            "-region",
            "4x3+2+2",
            "-emboss",
            "2x1",
            "+region"
        ],
        "rgba": "AABXfAAAABgOXIC0UgAAUI276fAAADuNEAAAKlew4sfPAABsAAAACjxnjqhNiABGh7vk8AAAD48AAAAua7TizQAAAHwAAAAcKKbZvIIAAFwAAAAQPWm0sVEAAFKOueHzEz7B/wD//wDw+///AF2D/ywAAFCJu+TzAFd/ljw7ADmLstr8AA5LoE5PAESA8Pv/ABtGqv8AAF2H9/v/AAYdn8cAGmwAAAASDyxJuIMAAF4AAAAwYIeu1////wD7AAAAl+T3/zJhh8FNlABMjbro9Fp/pdAAFi15AB0TIk5yk8svU3GsoQAAVgAAAAA+aY+qAABBkBsLADt2stzmHUtwkQAAAHwlJQAoe6zc1AAyWIDUAABwCwAAHXup2coAAFd3kgAAbA0AABp5ptfIAABXdrUAAHALAAAfWqfWzgApTH0AAA58HQ8ALGiq1twTOFyMAAlKkDMmAEF9sNnyAFR1ox9BXqyuAABeAAMAEGqh6cJcg6rQAAAAg0Q8ADaGt/PpiK/X/A0tS7CyAABk"
    },
    {
        "name": "plain",
        "operations": [
            "-emboss",
            "2x1"
        ],
        "rgba": "AABl/2V3SwAAQWztAP//AJe+7f8AACjGACjGACiMsP//AACId0FlADJlgf/t/wB3iN///wAAAFpBbOYAZbff/wAAAEQrT3MAAJ7G/wD//wAoS3MAKFqp/wD//wDJ7f//By+l/wD//wDG5v//AFZ3/wv//wCI4v//AF1+/wAA/wDf////AAAAzQAA/wBzze3/AAs5mv8AAFN31+3/AAAAGf8AAGyIrJcAAAAAKAD//wBBZd8AZYil2////wDtAAAAiKzb/yhad6UAAP8Aeprf/12FntcABzJ+SAAAAC9lerQoU3fC/wAAc6WIqQAyZYH/AAAyogAr/wBl1+3/HU9z/wAAAJcAAP8Ad5e+/wAvZf//AACFAChPAJe+3/8AAHP/AP//AAAZRACTu9//AABz//8AAA4AKE8AMsLf/wAoWv8AAACsAAvGAEHG5v8LMmX/AABBxgAA/wBPze3/AG+M3wAHMn4A//8AZQcvAEtzpf9liKzi////AAAAwgBvjOb/otft/wAAAFoA//8A"
    },
    {
        "name": "clipped region",
        "operations": [
            "-region",
            "4x3-2-1",
            "-emboss",
            "2x1",
            "+region"
        ],
        "rgba": "AABs/3CPSQANXoW0UwAAUI686fAAADqNDgAAKle05MfUAABsAAAACjlpkqj7/wCLnvv//wAAD48AAAAubbjkzQAAAHwAAAAcJ6rdvIkAAFwAAAAQO2u7sVEAAFKOuuHzK1/RrCoAAE6OuuLwAFN9kigAAFCJvOTzAFmDljk4ADmLs9r8AA1MoExOAER+tt7oJUdrsJgAAFWIs9r6AAYdn8sAGmwAAAASDi1JuIkAAF4AAAAwYYmw1wAAAH4AMS0lirLa/ChGaKROkQBMjbro9FqBp9AAFSt5ABsRIk51lssuVHasnwAAVgAAAAA8bJSqAABBkBcJADt3tN3mHUt0kQAAAHwkJQAofa3d1AAvW4DYAABwCgAAHX6s28oAAFp3mwAAbAwAABp7qNnIAABcdrkAAHAKAAAfWqrXzgAoTn0AAA18GQ0ALGms19wSNl+MAAhKkDAiAEF+sdnyAFR4ox9AYaywAABeAAIAEGyl7MJchazQAAAAg0A5ADaHufPpiLDX/A0tTLC1AABk"
    },
    {
        "name": "outside region",
        "operations": [
            "-region",
            "4x3+20+20",
            "-emboss",
            "2x1",
            "+region"
        ],
        "rgba": "AABbfAAAABgOX4W0UwAAUI686vAAADqNDwAAKli15sfTAABsAAAACjpqkahMhABGiLzl8AAAD48AAAAubrnlzQAAAHwAAAAcKKvfvIsAAFwAAAAQPG29sVIAAFKOuuLzK1/SrCsAAE6Ou+PwAFR8kikAAFCJvOTzAFmDljk4ADmLs9r8AA1MoE1OAER+t9/oJUdssJoAAFWIs9r6AAYdn8oAGmwAAAASDi1KuIwAAF4AAAAwYomx1wAAAH4AMS4lirLa/ChGaaROkwBMjbvp9FqBp9AAFSt5ABsRIk51lssuVXWsoAAAVgAAAAA8bJOqAABBkBcJADt3tN7mHUtzkQAAAHwlJQAofa7f1AAvW4DXAABwCgAAHX6s3coAAFp3mwAAbAwAABp7qdvIAABbdrkAAHAKAAAfWqrazgAoTn0AAA18GQ0ALGms2NwSNl+MAAhKkDEjAEF+sdnyAFR4ox9AYqyxAABeAAIAEG2l7sJdha3QAAAAg0A5ADaHufTpiLDX/A0tTLC2AABk"
    },
    {
        "name": "opaque",
        "operations": [
            "-alpha",
            "off",
            "-region",
            "4x3+2+2",
            "-emboss",
            "2x1",
            "+region"
        ],
        "rgba": "By5V/6PK8f8/Zo3/2wIp/3uiyf8YP2b/tdwD/1J5oP/3HkX/lbzj/zNagf/R+B//e6LJ/xpBaP+54Af/WH+m/wcuVf+nzvX/R26V/+cONf+bwun/PGOK/90EK/9+pcz/AAD///8AAP//////AAAA/9sCKf9+pcz/IUhv/8TrEv+HrtX/K1J5/8/2Hf8A////E1qC//8AAP8A////KlF4//ceRf+dxOv/Q2qR/+kQN/+74gn/Yomw/wAAAP8W////fcb0/wBEd//X/iX/f6bN/1uCqf8EK1L/rdT7/1Z9pP83XoX/4Qgv/4uy2f81XIP/G0Jp/8btFP9xmL//HENq/wcuVf+z2gH/X4at/wsyWf/7Ikn/qM/2/1V8o/8CKVD/9x5F/6XM8/9TeqH/AShP//siSf+q0fj/WYCn/wgvVv8HLlX/t94F/2eOtf8XPmX/G0Jp/8zzGv99pMv/LlV8/zdehf/pEDf/m8Lp/010m/9bgqn/DjVc/8HoD/90m8L/h67V/ztiif/vFj3/"
    }
];

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each(cases)(`matches every emboss pixel: $name, ${mode}`, async ({ operations, rgba }) => {
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
