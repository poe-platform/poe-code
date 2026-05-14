export type DebugStackMode = "trim" | "raw";

const HIDDEN_FRAME_SUMMARY_PREFIX = "    … (";
const HIDDEN_FRAME_SUMMARY_SUFFIX = " hidden — pass --debug=raw to show)";

interface StackSection {
  header: string;
  lines: string[];
}

export function enableSourceMaps(): void {
  process.setSourceMapsEnabled?.(true);
}

export function formatDebugStack(stack: string, mode: DebugStackMode): string {
  return mode === "raw" ? stack : trimStack(stack);
}

export function trimStack(stack: string): string {
  const sections = splitStackSections(stack);
  const trimmed = sections.map((section) => trimStackSection(section));
  const hiddenFrameCount = trimmed.reduce((count, section) => count + section.hiddenFrameCount, 0);

  if (hiddenFrameCount === 0) {
    return stack;
  }

  return trimmed.flatMap((section) => section.lines).join("\n");
}

function splitStackSections(stack: string): StackSection[] {
  const lines = stack.split("\n");
  const firstLine = lines[0];
  if (firstLine === undefined) {
    return [];
  }

  const sections: StackSection[] = [{ header: firstLine, lines: [] }];

  for (const line of lines.slice(1)) {
    if (isCauseHeader(line)) {
      sections.push({ header: line, lines: [] });
      continue;
    }

    sections[sections.length - 1]?.lines.push(line);
  }

  return sections;
}

function trimStackSection(section: StackSection): { lines: string[]; hiddenFrameCount: number } {
  const userFrames: string[] = [];
  const skippedFrames: string[] = [];

  for (const line of section.lines) {
    if (isFrameworkOrRuntimeFrame(line)) {
      skippedFrames.push(line);
      continue;
    }

    userFrames.push(line);
  }

  if (skippedFrames.length === 0) {
    return {
      lines: [section.header, ...section.lines],
      hiddenFrameCount: 0
    };
  }

  return {
    lines: [section.header, ...userFrames, formatHiddenFrameSummary(skippedFrames.length)],
    hiddenFrameCount: skippedFrames.length
  };
}

function isCauseHeader(line: string): boolean {
  return line.trimStart().startsWith("[cause]:");
}

function isFrameworkOrRuntimeFrame(line: string): boolean {
  const normalized = line.replaceAll("\\", "/");
  return (
    normalized.includes("node_modules/toolcraft/") ||
    normalized.includes("node_modules/toolcraft-openapi/") ||
    normalized.includes("node_modules/toolcraft-schema/") ||
    normalized.includes("node_modules/commander/") ||
    normalized.includes("node:internal/") ||
    normalized.includes("/packages/toolcraft/src/")
  );
}

function formatHiddenFrameSummary(count: number): string {
  const plural = count === 1 ? "" : "s";
  return `${HIDDEN_FRAME_SUMMARY_PREFIX}${count} framework / runtime frame${plural}${HIDDEN_FRAME_SUMMARY_SUFFIX}`;
}
