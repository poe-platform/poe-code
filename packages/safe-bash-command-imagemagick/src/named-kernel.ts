export function laplacianKernel(argument: number): number[] {
    const kernels: Record<number, number[]> = {
        0: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
        1: [0, -1, 0, -1, 4, -1, 0, -1, 0],
        2: [-2, 1, -2, 1, 4, 1, -2, 1, -2],
        3: [1, -2, 1, -2, 4, -2, 1, -2, 1],
        5: [-4, -1, 0, -1, -4, -1, 2, 3, 2, -1, 0, 3, 4, 3, 0, -1, 2, 3, 2, -1, -4, -1, 0, -1, -4],
        7: [-10, -5, -2, -1, -2, -5, -10, -5, 0, 3, 4, 3, 0, -5, -2, 3, 6, 7, 6, 3, -2, -1, 4, 7, 8, 7, 4, -1, -2, 3, 6, 7, 6, 3, -2, -5, 0, 3, 4, 3, 0, -5, -10, -5, -2, -1, -2, -5, -10],
        15: [0, 0, -1, 0, 0, 0, -1, -2, -1, 0, -1, -2, 16, -2, -1, 0, -1, -2, -1, 0, 0, 0, -1, 0, 0],
        19: [0, -1, -1, -2, -2, -2, -1, -1, 0, -1, -2, -4, -5, -5, -5, -4, -2, -1, -1, -4, -5, -3, 0, -3, -5, -4, -1, -2, -5, -3, 12, 24, 12, -3, -5, -2, -2, -5, 0, 24, 40, 24, 0, -5, -2, -2, -5, -3, 12, 24, 12, -3, -5, -2, -1, -4, -5, -3, 0, -3, -5, -4, -1, -1, -2, -4, -5, -5, -5, -4, -2, -1, 0, -1, -1, -2, -2, -2, -1, -1, 0],
    };
    return kernels[Math.trunc(argument)] ?? kernels[0]!;
}

export function gaussianKernelWeights(radius: number, sigma: number, gaussian: boolean): number[] {
    if (![radius, sigma].every(Number.isFinite) || Math.abs(radius) >= 5000 || sigma >= 5000)
        throw new Error("Invalid kernel: radius exceeds 5000");
    let half = radius >= 1 ? Math.floor(radius) : radius > 0 ? Math.ceil(radius) : 1;
    if (radius <= 0 && sigma > 1e-12) {
        let sum = 1 + 2 * Math.exp(-1 / (2 * sigma * sigma));
        for (half = 2; half < 5000; half++) {
            const edge = Math.exp(-half * half / (2 * sigma * sigma));
            sum += 2 * edge;
            if (edge / (gaussian ? sum * sum : sum) < 1 / 65535) { half--; break; }
        }
        if (half >= 5000) throw new Error("Invalid kernel: radius exceeds 5000");
    }
    const weights: number[] = [];
    let total = 0;
    for (let x = -half; x <= half; x++) {
        let weight = sigma <= 1e-12 ? Number(x === 0) : 0;
        if (sigma > 1e-12) for (let sub = !gaussian ? -1 : 0; sub <= (!gaussian ? 1 : 0); sub++)
            weight += Math.exp(-((x + sub / 3) ** 2) / (2 * sigma * sigma));
        weights.push(weight);
        total += weight;
    }
    return weights.map(weight => weight / total);
}
