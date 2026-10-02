export function markers(runId: string, markerPrefix: string): { begin: string; end: string } {
  return {
    begin: `# ${markerPrefix}:${runId} begin`,
    end: `# ${markerPrefix}:${runId} end`
  };
}

export function assertSingleLine(value: string, label: string): void {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`${label} must be a single line`);
  }
}

export function removeBlock(content: string, runId: string, markerPrefix: string): string {
  const { begin, end } = markers(runId, markerPrefix);
  const lines = content.split("\n");
  const result: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === begin) {
      const endIndex = lines.indexOf(end, index + 1);
      if (endIndex !== -1) {
        index = endIndex;
        continue;
      }
    }

    result.push(lines[index]);
  }

  return result.join("\n");
}

export function appendBlock(
  content: string | undefined,
  runId: string,
  entries: string[],
  markerPrefix: string
): string {
  const { begin, end } = markers(runId, markerPrefix);
  const existing = content ?? "";
  const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${prefix}${[begin, ...entries, end, ""].join("\n")}`;
}

export function nextBlockId(content: string | undefined, runId: string, markerPrefix: string): string {
  if (content === undefined || !content.includes(markers(runId, markerPrefix).begin)) {
    return runId;
  }

  let suffix = 1;
  while (content.includes(markers(`${runId}:${suffix}`, markerPrefix).begin)) {
    suffix += 1;
  }
  return `${runId}:${suffix}`;
}

