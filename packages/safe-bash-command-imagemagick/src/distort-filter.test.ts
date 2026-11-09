import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

// Native ImageMagick depth-8 RGBA results for identity and scaled/rotated SRT.
const cases = [
    {
        "options": [
            "-filter",
            "point"
        ],
        "args": "0",
        "expected": "1b446dff96bfe8ff113a63ff8cb5deff073059ff82abd4fffd264fff78a1cafff31c45ff6e97c0ffe9123bff648db6ffdf0831ff5a83acffd5fe27ff5079a2ffcbf41dff466f98ffc1ea13ff3c658effb7e009ff325b84ffadd6ffff28517aff",
        "operator": "-distort",
        "width": 6,
        "height": 4
    },
    {
        "options": [
            "-filter",
            "point"
        ],
        "args": "0.6,25",
        "expected": "fc264fff5d3b64ff7099c2ff29527bff2e5780ff82abd4ffd07a22ffe50e37ffa57493ff7e9dc6ff3a638cff82abd4ffc1ea13ff739c5bffb6df21ff9eb854ff5e87b0ff739cc5ffc1ea13ff608967ff4c756cff84add6ff315a83ff466f98ff",
        "operator": "-distort",
        "width": 6,
        "height": 4
    },
    {
        "options": [
            "-filter",
            "triangle"
        ],
        "args": "0",
        "expected": "1b446dff96bfe8ff113a63ff8cb5deff073059ff82abd4fffd264fff78a1cafff31c45ff6e97c0ffe9123bff648db6ffdf0831ff5a83acffd5fe27ff5079a2ffcbf41dff466f98ffc1ea13ff3c658effb7e009ff325b84ffadd6ffff28517aff",
        "operator": "-distort",
        "width": 6,
        "height": 4
    },
    {
        "options": [
            "-filter",
            "triangle"
        ],
        "args": "0.6,25",
        "expected": "c3264fff6f3962ff5d81aaff4a739cff456e97ff7099c2ffd17b23ffce434cff9c7e88ff7a6e97ff536c95ff82abd4ffc1ea13ff829e52ff8ab050ff929679ff73819bff729bc4ffadd625ff77a050ff6d966dff7099b6ff335c85ff466f98ff",
        "operator": "-distort",
        "width": 6,
        "height": 4
    },
    {
        "options": [
            "-filter",
            "box"
        ],
        "args": "0",
        "expected": "1b446dff96bfe8ff113a63ff8cb5deff073059ff82abd4fffd264fff78a1cafff31c45ff6e97c0ffe9123bff648db6ffdf0831ff5a83acffd5fe27ff5079a2ffcbf41dff466f98ffc1ea13ff3c658effb7e009ff325b84ffadd6ffff28517aff",
        "operator": "-distort",
        "width": 6,
        "height": 4
    },
    {
        "options": [
            "-filter",
            "box"
        ],
        "args": "0.6,25",
        "expected": "bd264fff8c355eff5982abff305982ff4a739cff82abd4ffd07922ffc52e57ffa3998fff675d86ff456e97ff82abd4ffc1ea13ff7fa851ff759e61ffa0968bff7e6790ff739cc5ffc1ea13ff7aa34cff537c65ff6b94bdff376089ff466f98ff",
        "operator": "-distort",
        "width": 6,
        "height": 4
    },
    {
        "options": [
            "-filter",
            "point",
            "+filter"
        ],
        "args": "0",
        "expected": "23446dff86bfe8ff213a63ff7cb5deff173059ff7aabd4fff5264fff8899caffe32c45ff7e87c0ffd9223bff6c85b6ffdf1031ff5a83acffd5ee27ff50899affcbe42dff467790ffc1e213ff3c6d8effb7e009ff325b8cffadd6efff285182ff",
        "operator": "-distort",
        "width": 6,
        "height": 4
    },
    {
        "options": [
            "-filter",
            "point"
        ],
        "args": "0.6,25",
        "expected": "1b446dff1b446dff1b446dff547da6ff8bb4ddff466f98fffc264fff5d3b64ff7099c2ff29527bff2e5780ff82abd4ffd07a22ffe50e37ffa57493ff7e9dc6ff3a638cff82abd4ffc1ea13ff739c5bffb6df21ff9eb854ff5e87b0ff739cc5ffc1ea13ff608967ff4c756cff84add6ff315a83ff466f98ff81aa4fffb6df0aff7099c2ff28517aff28517aff28517aff",
        "operator": "+distort",
        "width": 6,
        "height": 6
    },
    {
        "options": [
            "-filter",
            "triangle"
        ],
        "args": "0.6,25",
        "expected": "22436cff1b446dff355e87ff547da6ff537ca5ff4a739cffc3264fff6f3962ff5d81aaff4a739cff456e97ff7099c2ffd17b23ffce434cff9c7e88ff7a6e97ff536c95ff82abd4ffc1ea13ff829e52ff8ab050ff929679ff73819bff729bc4ffadd625ff77a050ff6d966dff7099b6ff335c85ff466f98ff84ad4bff7ea742ff6f98b9ff456e97ff28517aff29527bff",
        "operator": "+distort",
        "width": 6,
        "height": 6
    },
    {
        "options": [
            "-filter",
            "box"
        ],
        "args": "0.6,25",
        "expected": "1b446dff1b446dff345d86ff547da6ff4c759eff456e97ffbd264fff8c355eff5982abff305982ff4a739cff82abd4ffd07922ffc52e57ffa3998fff675d86ff456e97ff82abd4ffc1ea13ff7fa851ff759e61ffa0968bff7e6790ff739cc5ffc1ea13ff7aa34cff537c65ff6b94bdff376089ff466f98ff7fa851ff77a049ff7099c2ff436c95ff28517aff28517aff",
        "operator": "+distort",
        "width": 6,
        "height": 6
    },
    {
        "options": [
            "-filter",
            "triangle",
            "-define",
            "filter:blur=1.5"
        ],
        "args": "0.6,25",
        "expected": "ab334dff793f68ff5e6a93ff5578a1ff4b749dff6891baffd57e27ffb56054ff8f7a83ff76768cff657ca3ff77a0c9ffb9d31eff97a644ff879d66ff878e7fff6e8299ff6e97c0ffa4cd2dff7da64aff759e7bff62899eff446d8dff48719aff",
        "operator": "-distort",
        "width": 6,
        "height": 4
    }
];

it.each(cases.flatMap(test => [false, true].map(retained => ({ ...test, retained }))))(
    "uses $options during $operator SRT $args, retained=$retained",
    async ({ options, args, expected, operator, width, height, retained }) => {
        const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAYAAAAECAIAAAAiZtkUAAAAH0lEQVR4nGOUdsmtRgWMf9X80YXucxiiCx18JYwmBADurCHtclsDfQAAAABJRU5ErkJggg==", "base64"));
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const result = await runMagickCli(["/in.png", ...options, operator, "SRT", args, "/out.png"], retained ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(output.data).toEqual(Uint8Array.from(Buffer.from(expected, "hex")));
    }
);
