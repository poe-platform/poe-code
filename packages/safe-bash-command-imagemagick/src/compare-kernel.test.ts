import { expect, it } from "vitest";
import { compareImageSteps } from "./compare-kernel.js";
for (const [metric, expected] of Object.entries({ ae: "0", mae: "0 (0)", mse: "0 (0)", rmse: "0 (0)", pae: "0 (0)", psnr: "inf", ssim: "1", dssim: "0", ncc: "1" }))
    it(`preserves identical-image ${metric}`, () => {
        const image = { width: 3, height: 2, hasAlpha: false };
        const steps = compareImageSteps(image, image, { metric, fuzz: 0, highlightColor: { r: 241, g: 0, b: 30, a: 255 }, composeSrc: false, diff: false });
        let next = steps.next();
        while (!next.done) {
            if (next.value?.kind === "read") {
                const bytes = new Uint8Array(next.value.length);
                for (let i = 3; i < bytes.length; i += 4)
                    bytes[i] = 255;
                next = steps.next(bytes);
            }
            else
                next = steps.next();
        }
        expect(next.value).toEqual({ width: 3, height: 2, metric: expected, exitCode: 0 });
    });
it("scans and emits a multi-megabyte diff in bounded ordered chunks", () => {
    const image = { width: 2049, height: 513, hasAlpha: false }, steps = compareImageSteps(image, image, { metric: "ae", fuzz: 0, highlightColor: { r: 241, g: 0, b: 30, a: 255 }, composeSrc: false, diff: true });
    let next = steps.next(), written = 0, reads = 0, yields = 0;
    while (!next.done) {
        const request = next.value;
        if (request?.kind === "read") {
            expect(request.length).toBeLessThanOrEqual(4096);
            reads++;
            const bytes = new Uint8Array(request.length);
            for (let i = 3; i < bytes.length; i += 4)
                bytes[i] = 255;
            next = steps.next(bytes);
        }
        else {
            if (request) {
                expect(request.position).toBe(written);
                expect(request.data.length).toBeLessThanOrEqual(4096);
                expect([...request.data.subarray(0, 4)]).toEqual([179, 179, 179, 255]);
                written += request.data.length;
            }
            else
                yields++;
            next = steps.next();
        }
    }
    expect(next.value.metric).toBe("0");
    expect(written).toBe(image.width * image.height * 4);
    expect(reads).toBe(513 * 3 * 2);
    expect(yields).toBeGreaterThan(0);
});
it("accounts for premultiplied alpha and emits the configured difference color", () => {
    const image = { width: 1, height: 1, hasAlpha: true }, steps = compareImageSteps(image, image, { metric: "rmse", fuzz: 0, highlightColor: { r: 7, g: 19, b: 31, a: 43 }, composeSrc: false, diff: true });
    let next = steps.next(), output: Uint8Array | undefined;
    while (!next.done) {
        const request = next.value;
        if (request?.kind === "read")
            next = steps.next(new Uint8Array(request.image === 0 ? [255, 0, 0, 0] : [0, 0, 0, 255]));
        else {
            if (request)
                output = request.data;
            next = steps.next();
        }
    }
    expect(next.value.metric).toBe("32767.5 (0.5)");
    expect(next.value.exitCode).toBe(1);
    expect([...output!]).toEqual([7, 19, 31, 43]);
});
it("rejects incomplete pixel ranges before emitting a diff", () => {
    const image = { width: 2, height: 1, hasAlpha: false }, steps = compareImageSteps(image, image, { metric: "ae", fuzz: 0, highlightColor: { r: 0, g: 0, b: 0, a: 255 }, composeSrc: false, diff: true });
    let next = steps.next();
    while (!next.done && !next.value)
        next = steps.next();
    expect(() => steps.next(new Uint8Array(4))).toThrow("Truncated comparison pixels");
});
