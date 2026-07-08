import { pathToFileURL } from "node:url";
import { openExternal } from "toolcraft-design";
import type { TraceTreeNode } from "./types.js";
import { writeTraceHtml, type WriteTraceHtmlOptions } from "./write-html.js";

export interface OpenTraceHtmlOptions extends WriteTraceHtmlOptions {
  open?: (target: string) => Promise<void>;
}

export async function openTraceHtml(
  tree: TraceTreeNode,
  options: OpenTraceHtmlOptions
): Promise<{ path: string; bytes: number }> {
  const written = await writeTraceHtml(tree, options);
  const open = options.open ?? ((target: string) => openExternal(target));
  await open(pathToFileURL(written.path).href);
  return written;
}
