import type {
  CommandInfo,
  FormatColumnsOptions,
  OptionInfo
} from "./help-formatter.js";

export function stripAnsi(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\u001b") {
      if (value[index + 1] === "[") {
        index += 2;
        while (index < value.length) {
          const code = value.charCodeAt(index);
          if (code >= 0x40 && code <= 0x7e) {
            break;
          }
          index += 1;
        }
      }
      continue;
    }

    output += value[index];
  }
  return output;
}

function toAscii(value: string): string {
  let output = "";
  const stripped = stripAnsi(value);
  for (let index = 0; index < stripped.length; index += 1) {
    const code = stripped.charCodeAt(index);
    output += code <= 0x7f ? stripped[index] : "?";
  }
  return output;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function padEndVisible(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - value.length));
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r";
}

function splitWords(value: string): string[] {
  const words: string[] = [];
  let word = "";

  for (const char of value) {
    if (isWhitespace(char)) {
      if (word) {
        words.push(word);
        word = "";
      }
      continue;
    }
    word += char;
  }

  if (word) {
    words.push(word);
  }

  return words;
}

function wrapWords(value: string, width: number): string[] {
  const words = splitWords(value);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (!line) {
      line = word;
      continue;
    }

    if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
      continue;
    }

    lines.push(line);
    line = word;
  }

  lines.push(line);
  return lines;
}

export function formatColumns(opts: FormatColumnsOptions): string {
  const rows = opts.rows.map((row) => ({
    left: toAscii(row.left),
    right: toAscii(row.right)
  }));

  if (rows.length === 0) {
    return "";
  }

  const totalWidth = opts.totalWidth ?? process.stdout.columns ?? 100;
  const minLeftWidth = opts.minLeftWidth ?? 12;
  const maxLeftWidth = opts.maxLeftWidth ?? 32;
  const gap = opts.gap ?? 3;
  const indent = opts.indent ?? 2;
  const maxLeftContentWidth = Math.max(...rows.map((row) => row.left.length));
  const leftWidth = clamp(maxLeftContentWidth + gap, minLeftWidth, maxLeftWidth);
  const rightWidth = Math.max(20, totalWidth - leftWidth - indent);
  const firstIndent = " ".repeat(indent);
  const continuationIndent = " ".repeat(indent + leftWidth);

  return rows
    .flatMap((row) => {
      if (row.right.length === 0) {
        return [`${firstIndent}${row.left}`];
      }

      const rightLines = wrapWords(row.right, rightWidth);
      if (row.left.length >= leftWidth) {
        return [
          `${firstIndent}${row.left}`,
          ...rightLines.map((line) => `${continuationIndent}${line}`)
        ];
      }
      const firstLine = `${firstIndent}${padEndVisible(row.left, leftWidth)}${rightLines[0]}`;
      const continuationLines = rightLines
        .slice(1)
        .map((line) => `${continuationIndent}${line}`);
      return [firstLine, ...continuationLines];
    })
    .join("\n");
}

export function formatCommandList(commands: CommandInfo[]): string {
  return formatColumns({
    rows: commands.map((cmd) => ({
      left: cmd.name,
      right: cmd.description
    }))
  });
}

export function formatOptionList(options: OptionInfo[]): string {
  return formatColumns({
    rows: options.map((opt) => ({
      left: opt.flags,
      right: opt.description
    }))
  });
}
