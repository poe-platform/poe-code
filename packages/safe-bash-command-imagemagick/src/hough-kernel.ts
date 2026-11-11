import type { ConvolveRequest } from "./convolve-kernel.js";

type Color = { r: number; g: number; b: number; a: number };
type PixelSteps = Generator<ConvolveRequest | undefined, void, Uint8Array | undefined>;

/** Native angle/radius voting and local maxima, shared by the line and vote rasters. */
export function createHoughTransform(image: { width: number; height: number }, spec: string, background: Color, stroke: Color, fill: Color, strokeWidth: number) {
    const [window = "", thresholdText, extra] = spec.split("+");
    const [widthText, heightText, extraDimension] = window.split("x");
    const windowWidth = Number(widthText || 3), windowHeight = Number(heightText || widthText || 3);
    const threshold = Number(thresholdText || 0) || Math.floor(Math.max(image.width, image.height) / 4);
    if (extra !== undefined || extraDimension !== undefined || ![windowWidth, windowHeight, Number(thresholdText || 0)].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error("Invalid Hough line geometry");
    const radiusOffset = Math.SQRT2 * Math.max(image.width, image.height) / 2;
    const height = Math.floor(2 * radiusOffset);
    const votes = new Float64Array(180 * height);
    const cos = Float64Array.from({ length: 180 }, (_, angle) => Math.cos(angle * Math.PI / 180));
    const sin = Float64Array.from({ length: 180 }, (_, angle) => Math.sin(angle * Math.PI / 180));
    let maximum = 0;
    function* lines(): PixelSteps {
        for (let start = 0; start < image.width * image.height; start += 256) {
            yield;
            const count = Math.min(256, image.width * image.height - start);
            const bytes = yield { kind: "read", position: start * 4, length: count * 4 };
            if (!bytes || bytes.length !== count * 4) throw new Error("Truncated Hough pixels");
            for (let i = 0; i < count; i++) {
                if (0.212656 * bytes[i * 4]! + 0.715158 * bytes[i * 4 + 1]! + 0.072186 * bytes[i * 4 + 2]! <= 127.5) continue;
                const x = (start + i) % image.width - image.width / 2, y = Math.floor((start + i) / image.width) - image.height / 2;
                for (let angle = 0; angle < 180; angle++) {
                    const radius = Math.round(x * cos[angle]! + y * sin[angle]! + radiusOffset);
                    if (radius >= 0 && radius < height) maximum = Math.max(maximum, ++votes[radius * 180 + angle]!);
                }
            }
        }
        const segments: { x: number; y: number; dx: number; dy: number; lengthSquared: number }[] = [];
        for (let radius = 0; radius < height; radius++) for (let angle = 0; angle < 180; angle++) {
            if (angle === 0) yield;
            const count = votes[radius * 180 + angle]!;
            if (count < threshold) continue;
            let peak = true, work = 0;
            for (let y = Math.max(0, radius - Math.floor(windowHeight / 2)); peak && y <= Math.min(height - 1, radius + Math.floor(windowHeight / 2)); y++) {
                for (let x = Math.max(0, angle - Math.floor(windowWidth / 2)); x <= Math.min(179, angle + Math.floor(windowWidth / 2)); x++) {
                    if (++work % 4096 === 0) yield;
                    if (votes[y * 180 + x]! > count) { peak = false; break; }
                }
            }
            if (!peak) continue;
            const c = cos[angle]!, s = sin[angle]!, r = radius - height / 2;
            // Native MVG serialization keeps six significant digits in endpoints.
            const rounded = (value: number) => Number(value.toPrecision(6));
            const horizontal = angle >= 45 && angle <= 135;
            const x = horizontal ? 0 : rounded((r + image.height / 2 * s) / c + image.width / 2);
            const y = horizontal ? rounded((r + image.width / 2 * c) / s + image.height / 2) : 0;
            const dx = (horizontal ? image.width : rounded((r - image.height / 2 * s) / c + image.width / 2)) - x;
            const dy = (horizontal ? rounded((r - image.width / 2 * c) / s + image.height / 2) : image.height) - y;
            segments.push({ x, y, dx, dy, lengthSquared: dx * dx + dy * dy });
        }
        const mid = strokeWidth / 2;
        let work = 0;
        for (let start = 0; start < image.width * image.height; start += 1024) {
            yield;
            const count = Math.min(1024, image.width * image.height - start), data = new Uint8Array(count * 4);
            for (let i = 0; i < count; i++) {
                let r = background.r, g = background.g, b = background.b, a = background.a / 255;
                const x = (start + i) % image.width, y = Math.floor((start + i) / image.width);
                for (const line of segments) {
                    if (++work % 4096 === 0) yield;
                    // Native edge bounds exclude the leading edge and include the trailing edge.
                    if (x <= Math.min(line.x, line.x + line.dx) - mid - 0.5 || x > Math.max(line.x, line.x + line.dx) + mid + 0.5 ||
                        y <= Math.min(line.y, line.y + line.dy) - mid - 0.5 || y > Math.max(line.y, line.y + line.dy) + mid + 0.5) continue;
                    const t = Math.max(0, Math.min(1, ((x - line.x) * line.dx + (y - line.y) * line.dy) / line.lengthSquared));
                    const distance = Math.hypot(x - line.x - t * line.dx, y - line.y - t * line.dy);
                    const strokeCoverage = strokeWidth <= 0 || distance > mid + 0.75 ? 0 : distance <= Math.abs(mid - 0.25) ? 1 : (distance - mid - 0.75) ** 2;
                    const fillCoverage = distance < 1 ? (1 - distance) ** 2 : 0;
                    for (const [color, coverage] of [[fill, fillCoverage], [stroke, strokeCoverage]] as const) {
                        const alpha = coverage * color.a / 255, outAlpha = alpha + a * (1 - alpha);
                        if (outAlpha > 0) {
                            r = (color.r * alpha + r * a * (1 - alpha)) / outAlpha;
                            g = (color.g * alpha + g * a * (1 - alpha)) / outAlpha;
                            b = (color.b * alpha + b * a * (1 - alpha)) / outAlpha;
                        }
                        a = outAlpha;
                    }
                }
                data.set([Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)], i * 4);
            }
            yield { kind: "write", position: start * 4, data };
        }
    }
    function* accumulator(): PixelSteps {
        for (let start = 0; start < votes.length; start += 1024) {
            yield;
            const count = Math.min(1024, votes.length - start), data = new Uint8Array(count * 4);
            for (let i = 0; i < count; i++) {
                const gray = maximum ? Math.round(votes[start + i]! / maximum * 255) : 0;
                data.set([gray, gray, gray, 255], i * 4);
            }
            yield { kind: "write", position: start * 4, data };
        }
    }
    return { height, lines, accumulator };
}
