import { expect, it } from "vitest";
import { monoRasterInput } from "./mono-input.js";

it("reads arbitrary ranges across wide MONO rows with bounded source reads", () => {
    const width = 65539, height = 2, rowLength = Math.ceil(width / 8);
    const input = new Uint8Array(rowLength * height + 3).fill(0x80);
    input[3 + rowLength - 1] = 1;
    const header = new TextEncoder().encode(`P4\n${width} ${height}\n`);
    const expected = new Uint8Array(header.length + rowLength * height).fill(1);
    expected.set(header);
    expected[header.length + rowLength - 1] = 0x80;
    const raw = monoRasterInput(width, height, input.length, 3);
    for (const [position, size] of [[0, raw.size], [2, 7], [header.length - 1, 4], [header.length + rowLength - 1, 3]]) {
        const steps = raw.read(position!, size!);
        let next = steps.next();
        while (!next.done) {
            expect(next.value.length).toBeLessThanOrEqual(8192);
            expect(next.value.position + next.value.length).toBeLessThanOrEqual(input.length);
            next = steps.next(input.subarray(next.value.position, next.value.position + next.value.length));
        }
        expect(next.value).toEqual(expected.subarray(position!, position! + size!));
    }
});
