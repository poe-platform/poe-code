import type { MdNode } from "../ast.js";

type ParsedInlineNode = {
  node: MdNode;
  end: number;
};

export function parseInline(raw: string): MdNode[] {
  const nodes: MdNode[] = [];
  let textBuffer = "";
  let index = 0;

  const flushText = () => {
    if (textBuffer.length === 0) {
      return;
    }

    nodes.push({ type: "text", value: textBuffer });
    textBuffer = "";
  };

  while (index < raw.length) {
    const char = raw[index];

    if (char === "\\" && index + 1 < raw.length && isEscapable(raw[index + 1])) {
      textBuffer += raw[index + 1];
      index += 2;
      continue;
    }

    if (char === "`") {
      const code = parseInlineCode(raw, index);

      if (code !== null) {
        flushText();
        nodes.push(code.node);
        index = code.end;
        continue;
      }
    }

    if (char === "!" && index + 1 < raw.length && raw[index + 1] === "[") {
      const image = parseImage(raw, index);

      if (image !== null) {
        flushText();
        nodes.push(image.node);
        index = image.end;
        continue;
      }
    }

    if (char === "[") {
      const link = parseLink(raw, index);

      if (link !== null) {
        flushText();
        nodes.push(link.node);
        index = link.end;
        continue;
      }
    }

    if (char === "<") {
      const autolink = parseAutolink(raw, index);

      if (autolink !== null) {
        flushText();
        nodes.push(autolink.node);
        index = autolink.end;
        continue;
      }

      const html = parseInlineHtmlTag(raw, index);

      if (html !== null) {
        flushText();
        nodes.push(html.node);
        index = html.end;
        continue;
      }
    }

    textBuffer += char;
    index += 1;
  }

  flushText();

  return nodes;
}

function parseInlineCode(input: string, start: number): ParsedInlineNode | null {
  const fenceLength = readRunLength(input, start, "`");
  let index = start + fenceLength;

  while (index < input.length) {
    if (input[index] !== "`") {
      index += 1;
      continue;
    }

    const closingFenceLength = readRunLength(input, index, "`");

    if (closingFenceLength === fenceLength) {
      return {
        node: {
          type: "inlineCode",
          value: input.slice(start + fenceLength, index)
        },
        end: index + fenceLength
      };
    }

    index += closingFenceLength;
  }

  return null;
}

function parseLink(input: string, start: number): ParsedInlineNode | null {
  const label = parseBracketedLabel(input, start);

  if (label === null || label.end >= input.length || input[label.end] !== "(") {
    return null;
  }

  const destination = parseLinkDestination(input, label.end);

  if (destination === null) {
    return null;
  }

  return {
    node: {
      type: "link",
      url: destination.url,
      ...(destination.title === undefined ? {} : { title: destination.title }),
      children: parseInline(label.value)
    },
    end: destination.end
  };
}

function parseImage(input: string, start: number): ParsedInlineNode | null {
  const label = parseBracketedLabel(input, start + 1);

  if (label === null || label.end >= input.length || input[label.end] !== "(") {
    return null;
  }

  const destination = parseLinkDestination(input, label.end);

  if (destination === null) {
    return null;
  }

  return {
    node: {
      type: "image",
      url: destination.url,
      alt: decodeEscapes(label.value),
      ...(destination.title === undefined ? {} : { title: destination.title })
    },
    end: destination.end
  };
}

function parseBracketedLabel(
  input: string,
  start: number
): { value: string; end: number } | null {
  if (start >= input.length || input[start] !== "[") {
    return null;
  }

  let depth = 1;
  let index = start + 1;

  while (index < input.length) {
    const char = input[index];

    if (char === "\\" && index + 1 < input.length) {
      index += 2;
      continue;
    }

    if (char === "`") {
      const code = parseInlineCode(input, index);

      if (code !== null) {
        index = code.end;
        continue;
      }
    }

    if (char === "[") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;

      if (depth === 0) {
        return {
          value: input.slice(start + 1, index),
          end: index + 1
        };
      }
    }

    index += 1;
  }

  return null;
}

function parseLinkDestination(
  input: string,
  openParenIndex: number
): { url: string; title?: string; end: number } | null {
  let depth = 1;
  let quote: "\"" | "'" | null = null;
  let index = openParenIndex + 1;

  while (index < input.length) {
    const char = input[index];

    if (quote !== null) {
      if (char === "\\" && index + 1 < input.length) {
        index += 2;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (char === "\\" && index + 1 < input.length && isEscapable(input[index + 1])) {
      index += 2;
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;

      if (depth === 0) {
        const content = input.slice(openParenIndex + 1, index);
        const parsed = parseLinkDestinationContent(content);

        return {
          ...parsed,
          end: index + 1
        };
      }
    }

    index += 1;
  }

  return null;
}

function parseLinkDestinationContent(content: string): { url: string; title?: string } {
  const trimmedEnd = trimAsciiWhitespaceEndIndex(content);

  if (trimmedEnd === 0) {
    return { url: "" };
  }

  const quote = content[trimmedEnd - 1];

  if (quote === "\"" || quote === "'") {
    const titleStart = findTrailingQuotedSegmentStart(content, trimmedEnd, quote);

    if (titleStart !== -1) {
      let separatorStart = titleStart;

      while (separatorStart > 0 && isAsciiWhitespace(content[separatorStart - 1])) {
        separatorStart -= 1;
      }

      if (separatorStart < titleStart) {
        return {
          url: decodeEscapes(trimAsciiWhitespace(content.slice(0, separatorStart))),
          title: decodeEscapes(content.slice(titleStart + 1, trimmedEnd - 1))
        };
      }
    }
  }

  return { url: decodeEscapes(trimAsciiWhitespace(content.slice(0, trimmedEnd))) };
}

function findTrailingQuotedSegmentStart(
  content: string,
  end: number,
  quote: "\"" | "'"
): number {
  let index = end - 2;

  while (index >= 0) {
    if (content[index] === quote && !isEscaped(content, index)) {
      return index;
    }

    index -= 1;
  }

  return -1;
}

function parseAutolink(input: string, start: number): ParsedInlineNode | null {
  let index = start + 1;

  while (index < input.length && input[index] !== ">") {
    const char = input[index];

    if (char === "<" || char === "\n" || char === " " || char === "\t") {
      return null;
    }

    index += 1;
  }

  if (index >= input.length || index === start + 1) {
    return null;
  }

  const url = input.slice(start + 1, index);

  if (!isAutolinkUrl(url)) {
    return null;
  }

  return {
    node: {
      type: "link",
      url,
      children: [{ type: "text", value: url }]
    },
    end: index + 1
  };
}

function parseInlineHtmlTag(input: string, start: number): ParsedInlineNode | null {
  if (input[start] !== "<") {
    return null;
  }

  let index = start + 1;
  let closing = false;

  if (index < input.length && input[index] === "/") {
    closing = true;
    index += 1;
  }

  if (index >= input.length || !isAsciiLetter(input[index])) {
    return null;
  }

  index += 1;

  while (index < input.length && isHtmlTagNameChar(input[index])) {
    index += 1;
  }

  if (closing) {
    index = skipHtmlWhitespace(input, index);

    if (index >= input.length || input[index] !== ">") {
      return null;
    }

    return {
      node: { type: "html", value: input.slice(start, index + 1) },
      end: index + 1
    };
  }

  while (index < input.length) {
    index = skipHtmlWhitespace(input, index);

    if (index >= input.length) {
      return null;
    }

    if (input[index] === ">") {
      return {
        node: { type: "html", value: input.slice(start, index + 1) },
        end: index + 1
      };
    }

    if (input[index] === "/") {
      const selfClosingEnd = skipHtmlWhitespace(input, index + 1);

      if (selfClosingEnd >= input.length || input[selfClosingEnd] !== ">") {
        return null;
      }

      return {
        node: { type: "html", value: input.slice(start, selfClosingEnd + 1) },
        end: selfClosingEnd + 1
      };
    }

    if (!isHtmlAttributeNameStartChar(input[index])) {
      return null;
    }

    index += 1;

    while (index < input.length && isHtmlAttributeNameChar(input[index])) {
      index += 1;
    }

    index = skipHtmlWhitespace(input, index);

    if (index >= input.length || input[index] !== "=") {
      continue;
    }

    index = skipHtmlWhitespace(input, index + 1);

    if (index >= input.length) {
      return null;
    }

    const quote = input[index];

    if (quote === "\"" || quote === "'") {
      index += 1;

      while (index < input.length && input[index] !== quote) {
        index += 1;
      }

      if (index >= input.length) {
        return null;
      }

      index += 1;
      continue;
    }

    while (index < input.length && !isHtmlWhitespace(input[index]) && input[index] !== ">") {
      const char = input[index];

      if (char === "\"" || char === "'" || char === "<" || char === "=" || char === "`") {
        return null;
      }

      index += 1;
    }
  }

  return null;
}

function decodeEscapes(value: string): string {
  let result = "";
  let index = 0;

  while (index < value.length) {
    if (value[index] === "\\" && index + 1 < value.length && isEscapable(value[index + 1])) {
      result += value[index + 1];
      index += 2;
      continue;
    }

    result += value[index];
    index += 1;
  }

  return result;
}

function readRunLength(input: string, start: number, char: string): number {
  let index = start;

  while (index < input.length && input[index] === char) {
    index += 1;
  }

  return index - start;
}

function trimAsciiWhitespace(value: string): string {
  const start = trimAsciiWhitespaceStartIndex(value);
  const end = trimAsciiWhitespaceEndIndex(value);

  return value.slice(start, end);
}

function trimAsciiWhitespaceStartIndex(value: string): number {
  let index = 0;

  while (index < value.length && isAsciiWhitespace(value[index])) {
    index += 1;
  }

  return index;
}

function trimAsciiWhitespaceEndIndex(value: string): number {
  let index = value.length;

  while (index > 0 && isAsciiWhitespace(value[index - 1])) {
    index -= 1;
  }

  return index;
}

function isAutolinkUrl(value: string): boolean {
  if (value.length < 3 || !isAsciiLetter(value[0])) {
    return false;
  }

  let index = 1;

  while (index < value.length) {
    const char = value[index];

    if (char === ":") {
      return index >= 2;
    }

    if (!isAsciiLetter(char) && !isDigit(char) && char !== "+" && char !== "." && char !== "-") {
      return false;
    }

    index += 1;
  }

  return false;
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  let cursor = index - 1;

  while (cursor >= 0 && value[cursor] === "\\") {
    slashCount += 1;
    cursor -= 1;
  }

  return slashCount % 2 === 1;
}

function skipHtmlWhitespace(value: string, start: number): number {
  let index = start;

  while (index < value.length && isHtmlWhitespace(value[index])) {
    index += 1;
  }

  return index;
}

function isEscapable(value: string): boolean {
  return (
    value === "!" ||
    value === "\"" ||
    value === "#" ||
    value === "$" ||
    value === "%" ||
    value === "&" ||
    value === "'" ||
    value === "(" ||
    value === ")" ||
    value === "*" ||
    value === "+" ||
    value === "," ||
    value === "-" ||
    value === "." ||
    value === "/" ||
    value === ":" ||
    value === ";" ||
    value === "<" ||
    value === "=" ||
    value === ">" ||
    value === "?" ||
    value === "@" ||
    value === "[" ||
    value === "\\" ||
    value === "]" ||
    value === "^" ||
    value === "_" ||
    value === "`" ||
    value === "{" ||
    value === "|" ||
    value === "}" ||
    value === "~"
  );
}

function isAsciiWhitespace(value: string): boolean {
  return value === " " || value === "\t";
}

function isHtmlWhitespace(value: string): boolean {
  return value === " " || value === "\t";
}

function isAsciiLetter(value: string): boolean {
  return (value >= "a" && value <= "z") || (value >= "A" && value <= "Z");
}

function isDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function isHtmlTagNameChar(value: string): boolean {
  return isAsciiLetter(value) || isDigit(value) || value === "-";
}

function isHtmlAttributeNameStartChar(value: string): boolean {
  return isAsciiLetter(value) || value === ":" || value === "_";
}

function isHtmlAttributeNameChar(value: string): boolean {
  return (
    isHtmlAttributeNameStartChar(value) ||
    isDigit(value) ||
    value === "-" ||
    value === "."
  );
}
