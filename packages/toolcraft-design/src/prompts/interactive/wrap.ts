import { wrapAnsi } from "fast-wrap-ansi";
import stringWidth from "fast-string-width";

interface StreamSize {
  columns?: number;
  rows?: number;
}

export function getColumns(output: NodeJS.WritableStream): number {
  return Math.max(1, (output as StreamSize).columns ?? 80);
}

export function getRows(output: NodeJS.WritableStream): number {
  return Math.max(1, (output as StreamSize).rows ?? 20);
}

export function wrapTextWithPrefix(
  output: NodeJS.WritableStream,
  text: string,
  prefix: string,
  startPrefix = prefix
): string {
  const width = Math.max(1, getColumns(output) - stringWidth(prefix));
  return wrapAnsi(text, width, { hard: true, trim: false })
    .split("\n")
    .map((line, index) => `${index === 0 ? startPrefix : prefix}${line}`)
    .join("\n");
}

export function wrapFrame(output: NodeJS.WritableStream, frame: string): string {
  return wrapAnsi(frame, getColumns(output), { hard: true, trim: false });
}
