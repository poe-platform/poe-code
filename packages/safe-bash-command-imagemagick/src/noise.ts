/** Native differential noise in byte-scale HDRI units, with Q16 attenuation. */
export function* evaluateNoiseSteps(pixel: number, operation: string, attenuation: number, random: () => number): Generator<undefined, number, unknown> {
    switch (operation) {
        case "uniformnoise":
            return pixel + 255 * attenuation * 0.015625 * (random() - 0.5);
        case "gaussiannoise": {
            const alpha = random(), beta = random();
            const gamma = Math.sqrt(-2 * Math.log(Math.abs(alpha) < 1e-12 ? 1 : alpha));
            const angle = 2 * Math.PI * beta;
            return pixel + Math.sqrt(pixel * 257) / 257 * attenuation * 0.015625 * gamma * Math.cos(angle)
                + 255 * attenuation * 0.078125 * gamma * Math.sin(angle);
        }
        case "laplaciannoise": {
            const alpha = random();
            // Native adds half a Q16 quantum before byte encoding.
            if (alpha <= 0.5)
                return alpha <= 1e-12 ? pixel - 255
                    : pixel + 255 * attenuation * 0.0390625 * Math.log(2 * alpha) + 0.5 / 257;
            else {
                const beta = 1 - alpha;
                return beta <= 0.5e-12 ? pixel + 255
                    : pixel - 255 * attenuation * 0.0390625 * Math.log(2 * beta) + 0.5 / 257;
            }
        }
        case "multiplicativenoise": {
            const alpha = random(), beta = random();
            const sigma = alpha > 1e-12 ? Math.sqrt(-2 * Math.log(alpha)) : 1;
            return pixel + pixel * attenuation * 0.25 * sigma * Math.cos(2 * Math.PI * beta);
        }
        case "poissonnoise": {
            const sigma = attenuation * 12.5;
            const poisson = Math.exp(-sigma * pixel / 255);
            let alpha = random(), count = 0;
            while (alpha > poisson) {
                alpha *= random();
                if (++count % 256 === 0) yield;
            }
            return 255 * count / (Math.abs(sigma) < 1e-12 ? (sigma < 0 ? -1e-12 : 1e-12) : sigma);
        }
        case "impulsenoise": {
            const alpha = random();
            return alpha < attenuation * 0.05 ? 0 : alpha >= 1 - attenuation * 0.05 ? 255 : pixel;
        }
    }
    return pixel;
}
