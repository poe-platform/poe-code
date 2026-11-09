export function magickIntensity(r: number, g: number, b: number, method: string, quantum: number, linear: boolean): number {
    switch (method) {
        case "average": case "mean": return (r + g + b) / 3;
        case "brightness": return Math.max(r, g, b);
        case "lightness": return (Math.min(r, g, b) + Math.max(r, g, b)) / 2;
        case "ms": return (r * r + g * g + b * b) / (3 * quantum);
        case "rms": return Math.sqrt((r * r + g * g + b * b) / 3);
    }
    const luminance = method === "rec601luminance" || method === "rec709luminance";
    if (luminance && !linear) {
        r = quantum * (r / quantum <= 0.04045 ? r / quantum / 12.92 : ((r / quantum + 0.055) / 1.055) ** 2.4);
        g = quantum * (g / quantum <= 0.04045 ? g / quantum / 12.92 : ((g / quantum + 0.055) / 1.055) ** 2.4);
        b = quantum * (b / quantum <= 0.04045 ? b / quantum / 12.92 : ((b / quantum + 0.055) / 1.055) ** 2.4);
    } else if (!luminance && linear) {
        r = quantum * (r / quantum <= 0.0031308 ? r / quantum * 12.92 : 1.055 * (r / quantum) ** (1 / 2.4) - 0.055);
        g = quantum * (g / quantum <= 0.0031308 ? g / quantum * 12.92 : 1.055 * (g / quantum) ** (1 / 2.4) - 0.055);
        b = quantum * (b / quantum <= 0.0031308 ? b / quantum * 12.92 : 1.055 * (b / quantum) ** (1 / 2.4) - 0.055);
    }
    return method === "rec601luma" || method === "rec601luminance"
        ? 0.298839 * r + 0.586811 * g + 0.11435 * b
        : 0.212656 * r + 0.715158 * g + 0.072186 * b;
}
