import os from "node:os";
import path from "node:path";
import type { AgentTraceFileSystem } from "@poe-code/agent-traces";
import { renderTraceHtml, type RenderTraceHtmlOptions } from "./render-html.js";
import type { TraceTreeNode } from "./types.js";

export interface WriteTraceHtmlOptions {
  fs: AgentTraceFileSystem;
  outPath?: string;
  tmpDir?: string;
  renderOptions?: RenderTraceHtmlOptions;
}

export async function writeTraceHtml(
  tree: TraceTreeNode,
  options: WriteTraceHtmlOptions
): Promise<{ path: string; bytes: number }> {
  const html = renderTraceHtml(tree, options.renderOptions);
  const outPath = options.outPath ?? defaultHtmlPath(tree, options.tmpDir);
  await options.fs.mkdir(path.dirname(outPath), { recursive: true });
  await options.fs.writeFile(outPath, html, { encoding: "utf8" });
  return { path: outPath, bytes: Buffer.byteLength(html, "utf8") };
}

function defaultHtmlPath(tree: TraceTreeNode, tmpDir: string | undefined): string {
  const safeId = sanitizePathSegment(tree.view.id || "trace");
  return path.join(tmpDir ?? os.tmpdir(), "poe-code-traces", `trace-${safeId}.html`);
}

function sanitizePathSegment(value: string): string {
  const cleaned = value
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      const isAlpha =
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122);
      return isAlpha || character === "-" || character === "_" || character === "."
        ? character
        : "-";
    })
    .join("");
  return cleaned.length === 0 ? "trace" : cleaned.slice(0, 80);
}
