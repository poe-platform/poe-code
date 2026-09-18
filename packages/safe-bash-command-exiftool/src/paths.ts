import type { Resources } from "./resources.js";

/** Literal VFS resolution with scratch admission before splitting components. */
export function virtualPath(cwd: string, input: string, resources: Resources): string {
  if (input.includes("\0") || input === "-") throw new Error("Invalid or unsupported ExifTool file path");
  const extent = input.length + (input.startsWith("/") ? 0 : cwd.length + 1);
  // Includes separator-only and dot-only inputs with short normalized results.
  resources.admit("decoded", extent * 2);
  resources.admit("retained", extent * 32 + 256);
  resources.admit("work", extent * 24 + 16);
  const parts: string[] = [];
  for (const part of (input.startsWith("/") ? input : cwd + "/" + input).split("/")) {
    if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}
