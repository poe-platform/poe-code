const KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "const",
  "let",
  "var",
  "function",
  "return",
  "async",
  "await",
  "new",
  "type",
  "interface",
  "true",
  "false",
  "null",
  "undefined",
  "void"
]);

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

function escapeHtml(text: string): string {
  let out = "";
  for (const char of text) {
    out += ESCAPES[char] ?? char;
  }
  return out;
}

function span(token: string, text: string): string {
  return `<span class="tok-${token}">${escapeHtml(text)}</span>`;
}

function isSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isWordStart(char: string): boolean {
  return (
    (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_" || char === "$"
  );
}

function isWordPart(char: string): boolean {
  return isWordStart(char) || isDigit(char);
}

/**
 * Lightweight, dependency-free syntax highlighter for the short JS/TS and shell
 * snippets shown on the landing page. Single left-to-right pass so a keyword
 * inside a string or comment is never re-highlighted. Output is HTML-escaped
 * and safe to inline directly.
 */
export function highlight(code: string): string {
  let out = "";
  let index = 0;
  const length = code.length;

  while (index < length) {
    const char = code[index];
    const next = code[index + 1] ?? "";
    const previous = index > 0 ? code[index - 1] : "";

    if ((char === "/" && next === "/") || char === "#") {
      let end = index;
      while (end < length && code[end] !== "\n") {
        end += 1;
      }
      out += span("comment", code.slice(index, end));
      index = end;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      let end = index + 1;
      while (end < length && code[end] !== char) {
        if (code[end] === "\\") {
          end += 1;
        }
        end += 1;
      }
      end = Math.min(end + 1, length);
      out += span("str", code.slice(index, end));
      index = end;
      continue;
    }

    if (char === "-" && (next === "-" || isWordStart(next)) && (index === 0 || isSpace(previous))) {
      let end = index;
      while (end < length && (isWordPart(code[end]) || code[end] === "-")) {
        end += 1;
      }
      out += span("flag", code.slice(index, end));
      index = end;
      continue;
    }

    if (isDigit(char)) {
      let end = index;
      while (end < length && (isDigit(code[end]) || code[end] === ".")) {
        end += 1;
      }
      out += span("num", code.slice(index, end));
      index = end;
      continue;
    }

    if (isWordStart(char)) {
      let end = index;
      while (end < length && isWordPart(code[end])) {
        end += 1;
      }
      const word = code.slice(index, end);
      out += KEYWORDS.has(word) ? span("kw", word) : escapeHtml(word);
      index = end;
      continue;
    }

    out += escapeHtml(char);
    index += 1;
  }

  return out;
}
