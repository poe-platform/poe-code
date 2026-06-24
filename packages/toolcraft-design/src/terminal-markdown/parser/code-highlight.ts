import type { CodeToken, CodeTokenKind, MdNode } from "../ast.js";

type CodeHighlightFamily = "lexical" | "data" | "style" | "line";

type CodeLanguageInfo = {
  id: string;
  aliases: readonly string[];
  family?: CodeHighlightFamily;
  spec?: string;
  plain?: boolean;
};

type CodeTokenizer = (source: string, language: CodeLanguageInfo) => CodeToken[];

type TokenEmitter = {
  push(kind: CodeTokenKind, start: number, end: number): void;
  pushPlain(start: number, end: number): void;
};

type LexicalSpec = {
  keywords?: ReadonlySet<string>;
  types?: ReadonlySet<string>;
  constants?: ReadonlySet<string>;
  lineComments?: readonly string[];
  blockComments?: boolean;
  stringQuotes?: readonly string[];
  templateQuotes?: boolean;
  decorators?: boolean;
};

const codeLanguages: readonly CodeLanguageInfo[] = [
  {
    id: "javascript",
    aliases: ["js", "javascript", "mjs", "cjs", "es6"],
    family: "lexical",
    spec: "javascript"
  },
  { id: "javascriptreact", aliases: ["jsx"], family: "lexical", spec: "javascript" },
  {
    id: "typescript",
    aliases: ["ts", "typescript", "mts", "cts"],
    family: "lexical",
    spec: "typescript"
  },
  { id: "typescriptreact", aliases: ["tsx"], family: "lexical", spec: "typescript" },
  { id: "json", aliases: ["json"], family: "data", spec: "json" },
  { id: "jsonc", aliases: ["jsonc"], family: "data", spec: "jsonc" },
  { id: "jsonl", aliases: ["jsonl"], family: "data", spec: "json" },
  { id: "yaml", aliases: ["yaml", "yml"], family: "data", spec: "yaml" },
  { id: "css", aliases: ["css"], family: "style", spec: "css" },
  { id: "scss", aliases: ["scss"] },
  { id: "sass", aliases: ["sass"] },
  { id: "less", aliases: ["less"] },
  { id: "postcss", aliases: ["postcss"] },
  { id: "shellscript", aliases: ["sh", "bash", "shell", "shellscript", "zsh", "fish"] },
  { id: "python", aliases: ["py", "python"] },
  { id: "sql", aliases: ["sql", "ddl", "dml"] },
  { id: "html", aliases: ["html"] },
  { id: "xml", aliases: ["xml", "svg"] },
  { id: "markdown", aliases: ["md", "markdown"] },
  { id: "diff", aliases: ["diff", "patch"] },
  { id: "dockerfile", aliases: ["dockerfile", "docker"] },
  { id: "ini", aliases: ["ini", "properties"] },
  { id: "toml", aliases: ["toml"] },
  { id: "plaintext", aliases: ["text", "txt", "plain", "plaintext"], plain: true },
  { id: "ruby", aliases: ["rb", "ruby"] },
  { id: "go", aliases: ["go", "golang"] },
  { id: "java", aliases: ["java"] },
  { id: "c", aliases: ["c"] },
  { id: "cpp", aliases: ["cpp", "c++", "cc", "cxx"] },
  { id: "csharp", aliases: ["cs", "csharp", "c#"] },
  { id: "rust", aliases: ["rs", "rust"] },
  { id: "php", aliases: ["php"] }
] as const;

const languageByAlias = new Map<string, CodeLanguageInfo>();

for (const language of codeLanguages) {
  languageByAlias.set(language.id.toLowerCase(), language);

  for (const alias of language.aliases) {
    languageByAlias.set(alias.toLowerCase(), language);
  }
}

const jsKeywords = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "of",
  "return",
  "set",
  "static",
  "super",
  "switch",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield"
]);

const tsKeywords = new Set([
  ...jsKeywords,
  "abstract",
  "declare",
  "enum",
  "implements",
  "interface",
  "keyof",
  "namespace",
  "private",
  "protected",
  "public",
  "readonly",
  "satisfies",
  "type"
]);

const tsTypes = new Set([
  "any",
  "bigint",
  "boolean",
  "never",
  "number",
  "object",
  "string",
  "symbol",
  "unknown",
  "void"
]);

const jsConstants = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

const lexicalSpecs: Readonly<Record<string, LexicalSpec>> = {
  javascript: {
    keywords: jsKeywords,
    constants: jsConstants,
    lineComments: ["//"],
    blockComments: true,
    stringQuotes: ['"', "'"],
    templateQuotes: true,
    decorators: true
  },
  typescript: {
    keywords: tsKeywords,
    types: tsTypes,
    constants: jsConstants,
    lineComments: ["//"],
    blockComments: true,
    stringQuotes: ['"', "'"],
    templateQuotes: true,
    decorators: true
  }
};

const tokenizers: Readonly<Record<CodeHighlightFamily, CodeTokenizer>> = {
  lexical: tokenizeLexical,
  data: tokenizeData,
  style: tokenizeStyle,
  line: tokenizeLine
};

export function highlightCodeBlock(
  node: Pick<Extract<MdNode, { type: "code" }>, "lang" | "value" | "tokens">
): CodeToken[] | undefined {
  if (node.tokens !== undefined) {
    return node.tokens;
  }

  const language = resolveCodeLanguage(node.lang);
  if (
    language === undefined ||
    language.plain === true ||
    language.family === undefined ||
    node.value.length === 0
  ) {
    return undefined;
  }

  const tokenize = tokenizers[language.family];
  const tokens = tokenize(node.value, language);

  return tokens.some((token) => token.kind !== "plain") ? tokens : undefined;
}

function resolveCodeLanguage(lang: string | undefined): CodeLanguageInfo | undefined {
  if (lang === undefined || lang.length === 0) {
    return undefined;
  }

  return languageByAlias.get(lang.toLowerCase());
}

function tokenizeLexical(source: string, language: CodeLanguageInfo): CodeToken[] {
  const spec = lexicalSpecs[language.spec ?? ""];
  if (spec === undefined) {
    return [{ kind: "plain", value: source }];
  }

  const emitter = createEmitter(source);
  let index = 0;

  while (index < source.length) {
    const start = index;
    const char = source[index]!;

    index = readWhitespace(source, index);
    if (index > start) {
      emitter.pushPlain(start, index);
      continue;
    }

    const lineCommentEnd = readAnyLineComment(source, index, spec.lineComments ?? []);
    if (lineCommentEnd > index) {
      emitter.push("comment", index, lineCommentEnd);
      index = lineCommentEnd;
      continue;
    }

    const blockCommentEnd = spec.blockComments === true ? readBlockComment(source, index) : index;
    if (blockCommentEnd > index) {
      emitter.push("comment", index, blockCommentEnd);
      index = blockCommentEnd;
      continue;
    }

    if (spec.decorators === true && char === "@" && isIdentifierStart(source[index + 1] ?? "")) {
      index = readIdentifier(source, index + 1);
      emitter.push("decorator", start, index);
      continue;
    }

    if ((spec.stringQuotes ?? []).includes(char)) {
      index = readQuotedString(source, index, char);
      emitter.push("string", start, index);
      continue;
    }

    if (spec.templateQuotes === true && char === "`") {
      index = readQuotedString(source, index, "`");
      emitter.push("template", start, index);
      continue;
    }

    index = readNumber(source, index);
    if (index > start) {
      emitter.push("number", start, index);
      continue;
    }

    index = readIdentifier(source, index);
    if (index > start) {
      emitter.push(classifyLexicalWord(source.slice(start, index), spec), start, index);
      continue;
    }

    emitter.pushPlain(start, start + 1);
    index = start + 1;
  }

  return emitter.tokens;
}

function tokenizeData(source: string, language: CodeLanguageInfo): CodeToken[] {
  return language.spec === "yaml" ? tokenizeYaml(source) : tokenizeJsonLike(source, language.spec === "jsonc");
}

function tokenizeJsonLike(source: string, allowComments: boolean): CodeToken[] {
  const emitter = createEmitter(source);
  let index = 0;

  while (index < source.length) {
    const start = index;

    index = readWhitespace(source, index);
    if (index > start) {
      emitter.pushPlain(start, index);
      continue;
    }

    if (allowComments) {
      const lineCommentEnd = readAnyLineComment(source, index, ["//"]);
      if (lineCommentEnd > index) {
        emitter.push("comment", index, lineCommentEnd);
        index = lineCommentEnd;
        continue;
      }

      const blockCommentEnd = readBlockComment(source, index);
      if (blockCommentEnd > index) {
        emitter.push("comment", index, blockCommentEnd);
        index = blockCommentEnd;
        continue;
      }
    }

    if (source[index] === '"') {
      index = readQuotedString(source, index, '"');
      emitter.push(isJsonKey(source, index) ? "key" : "string", start, index);
      continue;
    }

    index = readNumber(source, index);
    if (index > start) {
      emitter.push("number", start, index);
      continue;
    }

    index = readIdentifier(source, index);
    if (index > start) {
      emitter.push(classifyDataWord(source.slice(start, index)), start, index);
      continue;
    }

    emitter.pushPlain(start, start + 1);
    index = start + 1;
  }

  return emitter.tokens;
}

function tokenizeYaml(source: string): CodeToken[] {
  const emitter = createEmitter(source);
  let index = 0;
  let atLineStart = true;

  while (index < source.length) {
    const start = index;

    if (source[index] === "\n") {
      emitter.pushPlain(index, index + 1);
      index += 1;
      atLineStart = true;
      continue;
    }

    const whitespaceEnd = readSpacesAndTabs(source, index);
    if (whitespaceEnd > index) {
      emitter.pushPlain(index, whitespaceEnd);
      index = whitespaceEnd;
      continue;
    }

    if (source[index] === "#") {
      index = readUntilLineEnd(source, index);
      emitter.push("comment", start, index);
      atLineStart = false;
      continue;
    }

    if (source[index] === '"' || source[index] === "'") {
      const quote = source[index]!;
      index = readQuotedString(source, index, quote);
      emitter.push("string", start, index);
      atLineStart = false;
      continue;
    }

    if (atLineStart) {
      const keyEnd = readYamlKey(source, index);
      if (keyEnd > index) {
        emitter.push("key", index, keyEnd);
        index = keyEnd;
        atLineStart = false;
        continue;
      }
    }

    index = readNumber(source, index);
    if (index > start) {
      emitter.push("number", start, index);
      atLineStart = false;
      continue;
    }

    index = readIdentifier(source, index);
    if (index > start) {
      emitter.push(classifyDataWord(source.slice(start, index)), start, index);
      atLineStart = false;
      continue;
    }

    emitter.pushPlain(start, start + 1);
    index = start + 1;
    atLineStart = false;
  }

  return emitter.tokens;
}

function tokenizeStyle(source: string): CodeToken[] {
  const emitter = createEmitter(source);
  let index = 0;

  while (index < source.length) {
    const start = index;

    index = readWhitespace(source, index);
    if (index > start) {
      emitter.pushPlain(start, index);
      continue;
    }

    const blockCommentEnd = readBlockComment(source, index);
    if (blockCommentEnd > index) {
      emitter.push("comment", index, blockCommentEnd);
      index = blockCommentEnd;
      continue;
    }

    if (source[index] === "@") {
      index = readCssName(source, index + 1);
      if (index > start + 1) {
        emitter.push("at-rule", start, index);
        continue;
      }
    }

    if (source[index] === "#" && isHex(source[index + 1] ?? "")) {
      index = readCssColor(source, index + 1);
      emitter.push("color", start, index);
      continue;
    }

    if (source.startsWith("!important", index)) {
      index += "!important".length;
      emitter.push("important", start, index);
      continue;
    }

    if (source[index] === '"' || source[index] === "'") {
      const quote = source[index]!;
      index = readQuotedString(source, index, quote);
      emitter.push("string", start, index);
      continue;
    }

    index = readNumber(source, index);
    if (index > start) {
      emitter.push("number", start, index);
      continue;
    }

    index = readCssName(source, index);
    if (index > start) {
      emitter.push(isCssProperty(source, index) ? "property" : "selector", start, index);
      continue;
    }

    emitter.pushPlain(start, start + 1);
    index = start + 1;
  }

  return emitter.tokens;
}

function tokenizeLine(source: string): CodeToken[] {
  return [{ kind: "plain", value: source }];
}

function createEmitter(source: string): TokenEmitter & { tokens: CodeToken[] } {
  const tokens: CodeToken[] = [];

  return {
    tokens,
    push(kind, start, end) {
      pushToken(tokens, source, kind, start, end);
    },
    pushPlain(start, end) {
      pushToken(tokens, source, "plain", start, end);
    }
  };
}

function pushToken(
  tokens: CodeToken[],
  source: string,
  kind: CodeTokenKind,
  start: number,
  end: number
): void {
  if (end <= start) {
    return;
  }

  const value = source.slice(start, end);
  const previous = tokens[tokens.length - 1];
  if (previous?.kind === kind) {
    previous.value += value;
    return;
  }

  tokens.push({ kind, value });
}

function classifyLexicalWord(word: string, spec: LexicalSpec): CodeTokenKind {
  if (word === "true" || word === "false") {
    return "boolean";
  }

  if (word === "null") {
    return "null";
  }

  if (spec.keywords?.has(word) === true) {
    return "keyword";
  }

  if (spec.types?.has(word) === true) {
    return "type";
  }

  if (spec.constants?.has(word) === true) {
    return "number";
  }

  return "plain";
}

function classifyDataWord(word: string): CodeTokenKind {
  switch (word) {
    case "true":
    case "false":
      return "boolean";
    case "null":
    case "Null":
    case "NULL":
    case "~":
      return "null";
    default:
      return "plain";
  }
}

function readWhitespace(source: string, index: number): number {
  while (index < source.length && isWhitespace(source[index]!)) {
    index += 1;
  }

  return index;
}

function readSpacesAndTabs(source: string, index: number): number {
  while (index < source.length && (source[index] === " " || source[index] === "\t")) {
    index += 1;
  }

  return index;
}

function readIdentifier(source: string, index: number): number {
  if (!isIdentifierStart(source[index] ?? "")) {
    return index;
  }

  index += 1;
  while (index < source.length && isIdentifierPart(source[index]!)) {
    index += 1;
  }

  return index;
}

function readCssName(source: string, index: number): number {
  if (!isCssNameStart(source[index] ?? "")) {
    return index;
  }

  index += 1;
  while (index < source.length && isCssNamePart(source[index]!)) {
    index += 1;
  }

  return index;
}

function readNumber(source: string, index: number): number {
  const start = index;
  if (source[index] === "-") {
    index += 1;
  }

  let hasDigit = false;
  while (index < source.length && isDigit(source[index]!)) {
    index += 1;
    hasDigit = true;
  }

  if (source[index] === "." && isDigit(source[index + 1] ?? "")) {
    index += 1;
    while (index < source.length && isDigit(source[index]!)) {
      index += 1;
      hasDigit = true;
    }
  }

  if (!hasDigit) {
    return start;
  }

  if ((source[index] === "e" || source[index] === "E") && isExponentStart(source[index + 1] ?? "")) {
    const exponentStart = index;
    index += 1;
    if (source[index] === "+" || source[index] === "-") {
      index += 1;
    }

    const digitsStart = index;
    while (index < source.length && isDigit(source[index]!)) {
      index += 1;
    }

    if (index === digitsStart) {
      return exponentStart;
    }
  }

  return index;
}

function readQuotedString(source: string, index: number, quote: string): number {
  index += 1;

  while (index < source.length) {
    const char = source[index]!;
    index += 1;

    if (char === "\\") {
      index = Math.min(source.length, index + 1);
      continue;
    }

    if (char === quote) {
      return index;
    }
  }

  return index;
}

function readAnyLineComment(
  source: string,
  index: number,
  markers: readonly string[]
): number {
  for (const marker of markers) {
    if (source.startsWith(marker, index)) {
      return readUntilLineEnd(source, index);
    }
  }

  return index;
}

function readBlockComment(source: string, index: number): number {
  if (!source.startsWith("/*", index)) {
    return index;
  }

  index += 2;
  while (index < source.length) {
    if (source.startsWith("*/", index)) {
      return index + 2;
    }

    index += 1;
  }

  return source.length;
}

function readUntilLineEnd(source: string, index: number): number {
  while (index < source.length && source[index] !== "\n") {
    index += 1;
  }

  return index;
}

function readYamlKey(source: string, index: number): number {
  const start = index;
  while (index < source.length) {
    const char = source[index]!;
    if (char === ":") {
      return index > start ? index : start;
    }

    if (char === "\n" || char === "#" || char === "{" || char === "}" || char === "[" || char === "]") {
      return start;
    }

    index += 1;
  }

  return start;
}

function readCssColor(source: string, index: number): number {
  let count = 0;

  while (index < source.length && isHex(source[index]!) && count < 8) {
    index += 1;
    count += 1;
  }

  return index;
}

function isJsonKey(source: string, index: number): boolean {
  index = readWhitespace(source, index);
  return source[index] === ":";
}

function isCssProperty(source: string, index: number): boolean {
  index = readWhitespace(source, index);
  return source[index] === ":";
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function isIdentifierStart(char: string): boolean {
  return isAlpha(char) || char === "_" || char === "$";
}

function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || isDigit(char);
}

function isCssNameStart(char: string): boolean {
  return isAlpha(char) || char === "_" || char === "-" || char === ".";
}

function isCssNamePart(char: string): boolean {
  return isCssNameStart(char) || isDigit(char);
}

function isExponentStart(char: string): boolean {
  return isDigit(char) || char === "+" || char === "-";
}

function isAlpha(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isHex(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 70) ||
    (code >= 97 && code <= 102)
  );
}
