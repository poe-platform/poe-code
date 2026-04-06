type ExtractedFrontmatter = {
  frontmatter?: Record<string, unknown>;
  body: string;
};

type Line = {
  text: string;
  start: number;
  nextPosition: number;
};

type YamlLine = {
  indent: number;
  content: string;
};

type ParsedKeyValue = {
  key: string;
  value?: string;
};

class FrontmatterParseError extends Error {}

class YamlSubsetParser {
  private readonly lines: YamlLine[];
  private position = 0;

  constructor(yamlBlock: string) {
    this.lines = tokenizeYamlBlock(yamlBlock);
  }

  parse(): Record<string, unknown> {
    this.skipBlankLines();

    if (this.position >= this.lines.length) {
      return {};
    }

    return this.parseObject(0);
  }

  private parseObject(expectedIndent: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    while (true) {
      this.skipBlankLines();

      const line = this.lines[this.position];

      if (line === undefined) {
        break;
      }

      if (line.indent < expectedIndent) {
        break;
      }

      if (line.indent !== expectedIndent || isArrayItem(line.content)) {
        throw new FrontmatterParseError("Invalid object indentation.");
      }

      const entry = parseKeyValue(line.content);

      if (entry === null || hasOwn(result, entry.key)) {
        throw new FrontmatterParseError("Invalid mapping entry.");
      }

      this.position += 1;
      result[entry.key] = this.readEntryValue(entry, expectedIndent);
    }

    return result;
  }

  private parseArray(expectedIndent: number): unknown[] {
    const result: unknown[] = [];

    while (true) {
      this.skipBlankLines();

      const line = this.lines[this.position];

      if (line === undefined) {
        break;
      }

      if (line.indent < expectedIndent) {
        break;
      }

      if (line.indent !== expectedIndent) {
        throw new FrontmatterParseError("Invalid array indentation.");
      }

      const item = parseArrayItem(line.content);

      if (item === null) {
        throw new FrontmatterParseError("Invalid array item.");
      }

      this.position += 1;

      if (item.length > 0) {
        result.push(parseScalar(item));
        continue;
      }

      const nestedLine = this.peekMeaningfulLine();

      if (nestedLine === undefined || nestedLine.indent <= expectedIndent) {
        result.push(null);
        continue;
      }

      result.push(
        isArrayItem(nestedLine.content)
          ? this.parseArray(nestedLine.indent)
          : this.parseObject(nestedLine.indent)
      );
    }

    return result;
  }

  private readEntryValue(entry: ParsedKeyValue, currentIndent: number): unknown {
    if (entry.value !== undefined) {
      return parseScalar(entry.value);
    }

    const nestedLine = this.peekMeaningfulLine();

    if (nestedLine === undefined || nestedLine.indent <= currentIndent) {
      return null;
    }

    return isArrayItem(nestedLine.content)
      ? this.parseArray(nestedLine.indent)
      : this.parseObject(nestedLine.indent);
  }

  private peekMeaningfulLine(): YamlLine | undefined {
    let index = this.position;

    while (index < this.lines.length) {
      const line = this.lines[index];

      if (line.content.length > 0) {
        return line;
      }

      index += 1;
    }

    return undefined;
  }

  private skipBlankLines(): void {
    while (this.position < this.lines.length && this.lines[this.position].content.length === 0) {
      this.position += 1;
    }
  }
}

export function extractFrontmatter(markdown: string): ExtractedFrontmatter {
  const content = stripBom(markdown);

  if (!startsWithFrontmatterFence(content)) {
    return { body: markdown };
  }

  const openingLine = readLine(content, 0);
  let position = openingLine.nextPosition;
  let closingFenceStart: number | undefined;
  let closingFenceNextPosition: number | undefined;

  while (position <= content.length) {
    const line = readLine(content, position);

    if (line.text === "---") {
      closingFenceStart = line.start;
      closingFenceNextPosition = line.nextPosition;
      break;
    }

    if (line.nextPosition >= content.length) {
      break;
    }

    position = line.nextPosition;
  }

  if (closingFenceStart === undefined || closingFenceNextPosition === undefined) {
    return { body: markdown };
  }

  const rawFrontmatter = sliceFrontmatterBlock(
    content,
    openingLine.nextPosition,
    closingFenceStart
  );
  const frontmatter = parseFrontmatterBlock(rawFrontmatter);

  return {
    frontmatter,
    body: content.slice(closingFenceNextPosition)
  };
}

function parseFrontmatterBlock(yamlBlock: string): Record<string, unknown> {
  if (yamlBlock.length === 0) {
    return {};
  }

  try {
    return new YamlSubsetParser(yamlBlock).parse();
  } catch (error) {
    if (error instanceof FrontmatterParseError) {
      return { raw: yamlBlock };
    }

    throw error;
  }
}

function tokenizeYamlBlock(yamlBlock: string): YamlLine[] {
  const lines = yamlBlock.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");

  return lines.map((line) => {
    let indent = 0;

    while (indent < line.length && line[indent] === " ") {
      indent += 1;
    }

    for (let index = 0; index < indent; index += 1) {
      if (line[index] === "\t") {
        throw new FrontmatterParseError("Tabs are not supported in frontmatter indentation.");
      }
    }

    if (indent < line.length && line[indent] === "\t") {
      throw new FrontmatterParseError("Tabs are not supported in frontmatter indentation.");
    }

    return {
      indent,
      content: line.slice(indent)
    };
  });
}

function parseKeyValue(content: string): ParsedKeyValue | null {
  const separator = findUnquotedMappingSeparator(content);

  if (separator === -1) {
    return null;
  }

  const key = trimAsciiWhitespace(content.slice(0, separator));

  if (key.length === 0) {
    return null;
  }

  const rawValue = trimAsciiWhitespaceStart(content.slice(separator + 1));

  return rawValue.length === 0 ? { key } : { key, value: rawValue };
}

function parseArrayItem(content: string): string | null {
  if (!isArrayItem(content)) {
    return null;
  }

  return trimAsciiWhitespaceStart(content.slice(1));
}

function isArrayItem(content: string): boolean {
  if (!content.startsWith("-")) {
    return false;
  }

  if (content.length === 1) {
    return true;
  }

  const nextCharacter = content[1];
  return nextCharacter === " " || nextCharacter === "\t";
}

function parseScalar(value: string): unknown {
  if (value.length === 0) {
    return "";
  }

  if (isQuoted(value, "'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }

  if (isQuoted(value, '"')) {
    return parseDoubleQuotedString(value.slice(1, -1));
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "null") {
    return null;
  }

  if (isNumberLiteral(value)) {
    return Number(value);
  }

  if (hasUnquotedMappingSeparator(value)) {
    throw new FrontmatterParseError(
      "Unquoted mapping separators are not supported in scalar values."
    );
  }

  return value;
}

function parseDoubleQuotedString(value: string): string {
  let result = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character !== "\\") {
      result += character;
      continue;
    }

    index += 1;

    if (index >= value.length) {
      result += "\\";
      break;
    }

    const escaped = value[index];

    if (escaped === "n") {
      result += "\n";
      continue;
    }

    if (escaped === "r") {
      result += "\r";
      continue;
    }

    if (escaped === "t") {
      result += "\t";
      continue;
    }

    if (escaped === "b") {
      result += "\b";
      continue;
    }

    if (escaped === "f") {
      result += "\f";
      continue;
    }

    if (escaped === '"' || escaped === "\\" || escaped === "/") {
      result += escaped;
      continue;
    }

    if (escaped === "u") {
      const codePoint = value.slice(index + 1, index + 5);

      if (codePoint.length === 4 && isHexadecimal(codePoint)) {
        result += String.fromCodePoint(Number.parseInt(codePoint, 16));
        index += 4;
        continue;
      }
    }

    result += `\\${escaped}`;
  }

  return result;
}

function isQuoted(value: string, quote: "'" | '"'): boolean {
  return value.length >= 2 && value[0] === quote && value[value.length - 1] === quote;
}

function isNumberLiteral(value: string): boolean {
  let index = 0;
  let hasDigits = false;
  let hasDecimal = false;

  if (value[index] === "-" || value[index] === "+") {
    index += 1;
  }

  while (index < value.length) {
    const character = value[index];

    if (character >= "0" && character <= "9") {
      hasDigits = true;
      index += 1;
      continue;
    }

    if (character === "." && !hasDecimal) {
      hasDecimal = true;
      index += 1;
      continue;
    }

    return false;
  }

  return hasDigits;
}

function hasUnquotedMappingSeparator(value: string): boolean {
  return findUnquotedMappingSeparator(value) !== -1;
}

function findUnquotedMappingSeparator(value: string): number {
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote !== null) {
      if (character === "\\" && quote === '"') {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character !== ":") {
      continue;
    }

    const nextCharacter = value[index + 1];

    if (nextCharacter === undefined || nextCharacter === " " || nextCharacter === "\t") {
      return index;
    }
  }

  return -1;
}

function sliceFrontmatterBlock(content: string, start: number, end: number): string {
  let sliceEnd = end;

  if (sliceEnd > start && content[sliceEnd - 1] === "\n") {
    sliceEnd -= 1;

    if (sliceEnd > start && content[sliceEnd - 1] === "\r") {
      sliceEnd -= 1;
    }
  }

  return content.slice(start, sliceEnd);
}

function startsWithFrontmatterFence(value: string): boolean {
  return value.startsWith("---\n") || value.startsWith("---\r\n");
}

function stripBom(value: string): string {
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

function readLine(input: string, position: number): Line {
  let end = position;

  while (end < input.length && input[end] !== "\n" && input[end] !== "\r") {
    end += 1;
  }

  let nextPosition = end;

  if (input[nextPosition] === "\r" && input[nextPosition + 1] === "\n") {
    nextPosition += 2;
  } else if (input[nextPosition] === "\n" || input[nextPosition] === "\r") {
    nextPosition += 1;
  }

  return {
    text: input.slice(position, end),
    start: position,
    nextPosition
  };
}

function trimAsciiWhitespace(value: string): string {
  return trimAsciiWhitespaceEnd(trimAsciiWhitespaceStart(value));
}

function trimAsciiWhitespaceStart(value: string): string {
  let start = 0;

  while (start < value.length && (value[start] === " " || value[start] === "\t")) {
    start += 1;
  }

  return value.slice(start);
}

function trimAsciiWhitespaceEnd(value: string): string {
  let end = value.length;

  while (end > 0 && (value[end - 1] === " " || value[end - 1] === "\t")) {
    end -= 1;
  }

  return value.slice(0, end);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isHexadecimal(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (
      (character >= "0" && character <= "9") ||
      (character >= "a" && character <= "f") ||
      (character >= "A" && character <= "F")
    ) {
      continue;
    }

    return false;
  }

  return true;
}
