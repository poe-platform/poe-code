/** ImageMagick's automatic methods use 256 intensity bins even for 16-bit input. */
export function automaticThreshold(luminance: Float64Array, method: string): number {
    const histogram = new Float64Array(256);
    let count = 0;
    for (let i = 0; i < luminance.length; i++) {
        histogram[Math.round(i / 257)]! += luminance[i]!;
        count += luminance[i]!;
    }
    for (let i = 0; i < 256; i++) histogram[i]! *= count ? 1 / count : 0;
    let threshold = 0, maximum = 0;
    if (method === "triangle") {
        let start = 0, end = 255, peak = 0;
        while (start < 255 && !histogram[start]) start++;
        while (end > 0 && !histogram[end]) end--;
        for (let i = 1; i < 256; i++) if (histogram[i]! > histogram[peak]!) peak = i;
        const left = peak - start >= end - peak;
        const a = histogram[peak]!, b = (left ? start : end) - peak, c = -(a * peak + b * histogram[peak]!);
        const scale = 1 / Math.sqrt(a * a + b * b + c * c);
        for (let i = left ? start : end; left ? i < peak : i > peak; i += left ? 1 : -1) {
            const segment = scale * (a * i + b * histogram[i]! + c);
            if (Math.abs(segment) > maximum && (left ? segment > 0 : segment < 0)) {
                maximum = Math.abs(segment);
                threshold = i;
            }
        }
    } else if (method === "otsu") {
        let mean = 0, weight = 0, partialMean = 0;
        for (let i = 0; i < 256; i++) mean += i * histogram[i]!;
        for (let i = 0; i < 255; i++) {
            weight += histogram[i]!;
            partialMean += i * histogram[i]!;
            const variance = weight !== 0 && weight !== 1 ? (mean * weight - partialMean) ** 2 / (weight * (1 - weight)) : 0;
            if (variance > maximum) { maximum = variance; threshold = i; }
        }
    } else {
        let weight = 0;
        for (let split = 0; split < 256; split++) {
            weight += histogram[split]!;
            let blackEntropy = 0, whiteEntropy = 0;
            // Preserve native summation and tie-breaking, including near-empty classes.
            for (let i = 0; i < 256; i++) {
                const mass = i <= split ? weight : 1 - weight;
                if (histogram[i]! > 0 && mass > 0) {
                    const probability = histogram[i]! / mass;
                    if (i <= split) blackEntropy -= probability * Math.log(probability);
                    else whiteEntropy -= probability * Math.log(probability);
                }
            }
            const entropy = blackEntropy + whiteEntropy;
            if (split === 0 || entropy > maximum) { maximum = entropy; threshold = split; }
        }
    }
    return 100 * threshold / 255;
}
