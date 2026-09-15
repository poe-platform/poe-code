import { randomUUID } from "node:crypto";
import {
  limitOutputPreview,
  MAX_OUTPUT_PREVIEW_CHARS,
  OUTPUT_TRUNCATION_NOTICE,
  retainOutputTail
} from "./output-preview.js";
import { createTerminalStringFilter } from "./terminal-strings.js";

export function createDashboardLineBuffer(emit: (line: string) => void): {
  push(chunk: string): void;
  flush(): void;
  preview(): string;
} {
  let pending = "";
  let omitted = false;
  const strings = createTerminalStringFilter();
  return {
    preview(): string {
      const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
      return (omitted ? OUTPUT_TRUNCATION_NOTICE : "") + line;
    },
    push(chunk): void {
      const text = pending + strings.push(chunk);
      let start = 0;
      let newline = text.indexOf("\n");
      while (newline !== -1) {
        const raw = text.slice(start, newline);
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        emit(limitOutputPreview((omitted ? OUTPUT_TRUNCATION_NOTICE : "") + line));
        omitted = false;
        start = newline + 1;
        newline = text.indexOf("\n", start);
      }
      const remaining = text.slice(start);
      if (remaining.length > MAX_OUTPUT_PREVIEW_CHARS) omitted = true;
      const budget = MAX_OUTPUT_PREVIEW_CHARS - (omitted ? OUTPUT_TRUNCATION_NOTICE.length : 0);
      pending = retainOutputTail(remaining, budget);
    },
    flush(): void {
      if (pending.length === 0) return;
      const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
      emit((omitted ? OUTPUT_TRUNCATION_NOTICE : "") + line);
      pending = "";
      omitted = false;
    }
  };
}

export function createStreamingDashboardLineBuffer(emit: (line: string, id: string) => void): {
  push(chunk: string): void;
  flush(): void;
} {
  let id = randomUUID();
  let lastPreview = "";
  const lines = createDashboardLineBuffer(line => {
    if (line.length === 0 || line !== lastPreview) emit(line, id);
    id = randomUUID();
    lastPreview = "";
  });
  return {
    push(chunk): void {
      if (chunk.length === 0) return;
      lines.push(chunk);
      const preview = lines.preview();
      if (preview.length > 0 && preview !== lastPreview) {
        lastPreview = preview;
        emit(preview, id);
      }
    },
    flush: lines.flush
  };
}
