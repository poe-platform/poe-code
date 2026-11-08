import type {SharpInputOptions} from "./ast.js";

export function checkLimitInputPixels(width: number, height: number, options?: SharpInputOptions): void {
  const limit =
    options?.limitInputPixels === false ||
    options?.limitInputPixels === 0 ||
    (options?.unlimited === true && options?.limitInputPixels === undefined)
      ? Infinity
      : typeof options?.limitInputPixels === "number"
        ? options.limitInputPixels
        : Infinity;
  if (width * height > limit) {
    throw new Error(`Input image exceeds pixel limit (${width}x${height} > ${limit})`);
  }
}
