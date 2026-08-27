import { ansiToCells } from "../screen/ansi-text.js";
import { renderMarkdown } from "../terminal-markdown/index.js";

export interface PreparedDetailContent {
  text: string;
  lines: ReturnType<typeof ansiToCells>[];
}

const markdownCache = new Map<string, PreparedDetailContent>();

export function prepareDetailContent(content: string, width: number): PreparedDetailContent {
  if (content.trim().length === 0) {
    return { text: "", lines: [[]] };
  }

  width = Math.max(1, width);
  const key = `${contentHash(content)}:${width}`;
  const cached = markdownCache.get(key);
  if (cached !== undefined) return cached;
  const text = renderMarkdown(content, { width }).trimEnd();
  const lines: ReturnType<typeof ansiToCells>[] = [[]];
  for (const cell of ansiToCells(text)) {
    if (cell.ch === "\n") lines.push([]);
    else lines.at(-1)!.push(cell);
  }
  const prepared = { text, lines };
  markdownCache.set(key, prepared);
  return prepared;
}

function contentHash(content: string): number {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
