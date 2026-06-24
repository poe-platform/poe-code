import type { CodeToken, CodeTokenKind, MdNode } from "../ast.js";

type CodeHighlightFamily = "lexical" | "data" | "style" | "line" | "markup";

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
  booleans?: ReadonlySet<string>;
  nulls?: ReadonlySet<string>;
  commands?: ReadonlySet<string>;
  lineComments?: readonly string[];
  blockComments?: boolean;
  stringQuotes?: readonly string[];
  templateQuotes?: boolean;
  tripleStringQuotes?: boolean;
  decorators?: boolean;
  rustAttributes?: boolean;
  variablePrefix?: "$";
  flags?: boolean;
  caseInsensitive?: boolean;
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
  { id: "scss", aliases: ["scss"], family: "style", spec: "css" },
  { id: "sass", aliases: ["sass"], family: "style", spec: "css" },
  { id: "less", aliases: ["less"], family: "style", spec: "css" },
  { id: "postcss", aliases: ["postcss"], family: "style", spec: "css" },
  { id: "shellscript", aliases: ["sh", "bash", "shell", "shellscript", "zsh", "fish"], family: "lexical", spec: "shell" },
  { id: "python", aliases: ["py", "python"], family: "lexical", spec: "python" },
  { id: "sql", aliases: ["sql", "ddl", "dml"], family: "lexical", spec: "sql" },
  { id: "html", aliases: ["html"], family: "markup", spec: "html" },
  { id: "xml", aliases: ["xml", "svg"], family: "markup", spec: "xml" },
  { id: "markdown", aliases: ["md", "markdown"], family: "line", spec: "markdown" },
  { id: "diff", aliases: ["diff", "patch"], family: "line", spec: "diff" },
  { id: "dockerfile", aliases: ["dockerfile", "docker"], family: "line", spec: "dockerfile" },
  { id: "ini", aliases: ["ini", "properties"], family: "data", spec: "ini" },
  { id: "toml", aliases: ["toml"], family: "data", spec: "toml" },
  { id: "plaintext", aliases: ["text", "txt", "plain", "plaintext"], plain: true },
  { id: "ruby", aliases: ["rb", "ruby"], family: "lexical", spec: "ruby" },
  { id: "go", aliases: ["go", "golang"], family: "lexical", spec: "go" },
  { id: "java", aliases: ["java"], family: "lexical", spec: "java" },
  { id: "c", aliases: ["c"], family: "lexical", spec: "c" },
  { id: "cpp", aliases: ["cpp", "c++", "cc", "cxx"], family: "lexical", spec: "cpp" },
  { id: "csharp", aliases: ["cs", "csharp", "c#"], family: "lexical", spec: "csharp" },
  { id: "rust", aliases: ["rs", "rust"], family: "lexical", spec: "rust" },
  { id: "php", aliases: ["php"], family: "lexical", spec: "php" }
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

const pythonKeywords = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "case",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "match",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield"
]);

const pythonTypes = new Set(["Any", "Callable", "Iterable", "None", "Protocol", "Self", "TypeVar", "bool", "bytes", "dict", "float", "int", "list", "object", "set", "str", "tuple"]);
const pythonBooleans = new Set(["True", "False"]);
const pythonNulls = new Set(["None", "NotImplemented", "Ellipsis"]);

const shellKeywords = new Set(["case", "do", "done", "elif", "else", "esac", "fi", "for", "function", "if", "in", "select", "then", "until", "while"]);
const shellCommands = new Set(["awk", "cat", "cd", "chmod", "cp", "echo", "env", "export", "find", "grep", "mkdir", "mv", "printf", "pwd", "rm", "sed", "test"]);

const sqlKeywords = new Set([
  "add",
  "alter",
  "and",
  "as",
  "by",
  "case",
  "create",
  "delete",
  "desc",
  "distinct",
  "drop",
  "else",
  "end",
  "exists",
  "from",
  "group",
  "having",
  "in",
  "insert",
  "into",
  "is",
  "join",
  "left",
  "limit",
  "not",
  "null",
  "on",
  "or",
  "order",
  "outer",
  "primary",
  "references",
  "right",
  "select",
  "set",
  "table",
  "then",
  "union",
  "update",
  "values",
  "when",
  "where"
]);

const rubyKeywords = new Set(["alias", "and", "begin", "break", "case", "class", "def", "defined?", "do", "else", "elsif", "end", "ensure", "false", "for", "if", "in", "module", "next", "nil", "not", "or", "redo", "rescue", "retry", "return", "self", "super", "then", "true", "undef", "unless", "until", "when", "while", "yield"]);
const rubyBooleans = new Set(["true", "false"]);
const rubyNulls = new Set(["nil"]);

const goKeywords = new Set(["break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func", "go", "goto", "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var"]);
const goTypes = new Set(["any", "bool", "byte", "complex128", "complex64", "error", "float32", "float64", "int", "int16", "int32", "int64", "int8", "rune", "string", "uint", "uint16", "uint32", "uint64", "uint8", "uintptr"]);
const goBooleans = new Set(["true", "false"]);
const goNulls = new Set(["nil"]);

const javaKeywords = new Set(["abstract", "assert", "break", "case", "catch", "class", "const", "continue", "default", "do", "else", "enum", "extends", "final", "finally", "for", "if", "implements", "import", "instanceof", "interface", "native", "new", "package", "private", "protected", "public", "return", "static", "strictfp", "super", "switch", "synchronized", "this", "throw", "throws", "transient", "try", "volatile", "while"]);
const javaTypes = new Set(["Boolean", "Byte", "Character", "Double", "Float", "Integer", "Long", "Object", "Optional", "Short", "String", "Void", "boolean", "byte", "char", "double", "float", "int", "long", "short", "void"]);
const javaBooleans = new Set(["true", "false"]);
const javaNulls = new Set(["null"]);

const cKeywords = new Set(["auto", "break", "case", "const", "continue", "default", "do", "else", "enum", "extern", "for", "goto", "if", "inline", "register", "restrict", "return", "sizeof", "static", "struct", "switch", "typedef", "union", "volatile", "while"]);
const cTypes = new Set(["bool", "char", "double", "float", "int", "int16_t", "int32_t", "int64_t", "int8_t", "long", "short", "size_t", "uint16_t", "uint32_t", "uint64_t", "uint8_t", "void"]);

const cppKeywords = new Set([...cKeywords, "alignas", "alignof", "and", "bitand", "bitor", "catch", "class", "concept", "constexpr", "consteval", "constinit", "decltype", "delete", "explicit", "export", "friend", "mutable", "namespace", "new", "noexcept", "not", "operator", "or", "private", "protected", "public", "requires", "template", "this", "throw", "try", "typename", "using", "virtual", "xor"]);
const cppTypes = new Set([...cTypes, "auto", "bool", "char16_t", "char32_t", "std", "string", "wstring"]);
const cppBooleans = new Set(["true", "false"]);
const cppNulls = new Set(["nullptr", "NULL"]);

const csharpKeywords = new Set(["abstract", "as", "base", "break", "case", "catch", "checked", "class", "const", "continue", "default", "delegate", "do", "else", "enum", "event", "explicit", "extern", "finally", "fixed", "for", "foreach", "if", "implicit", "in", "interface", "internal", "is", "lock", "namespace", "new", "operator", "out", "override", "params", "private", "protected", "public", "readonly", "record", "ref", "return", "sealed", "sizeof", "stackalloc", "static", "struct", "switch", "this", "throw", "try", "typeof", "unchecked", "unsafe", "using", "virtual", "void", "volatile", "while"]);
const csharpTypes = new Set(["bool", "byte", "char", "decimal", "double", "dynamic", "float", "int", "long", "nint", "nuint", "object", "sbyte", "short", "string", "uint", "ulong", "ushort", "var"]);

const rustKeywords = new Set(["as", "async", "await", "box", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while"]);
const rustTypes = new Set(["Box", "Option", "Result", "Some", "String", "Vec", "bool", "char", "f32", "f64", "i128", "i16", "i32", "i64", "i8", "isize", "str", "u128", "u16", "u32", "u64", "u8", "usize"]);
const rustBooleans = new Set(["true", "false"]);
const rustNulls = new Set(["None"]);

const phpKeywords = new Set(["abstract", "and", "array", "as", "break", "callable", "case", "catch", "class", "clone", "const", "continue", "declare", "default", "do", "echo", "else", "elseif", "empty", "enddeclare", "endfor", "endforeach", "endif", "endswitch", "endwhile", "enum", "extends", "final", "finally", "fn", "for", "foreach", "function", "global", "if", "implements", "include", "instanceof", "interface", "isset", "match", "namespace", "new", "or", "private", "protected", "public", "readonly", "require", "return", "static", "switch", "throw", "trait", "try", "use", "var", "while", "xor", "yield"]);
const phpTypes = new Set(["array", "bool", "callable", "false", "float", "int", "iterable", "mixed", "never", "null", "object", "self", "static", "string", "true", "void"]);

const lexicalSpecs: Readonly<Record<string, LexicalSpec>> = {
  javascript: {
    keywords: jsKeywords,
    constants: jsConstants,
    booleans: new Set(["true", "false"]),
    nulls: new Set(["null"]),
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
    booleans: new Set(["true", "false"]),
    nulls: new Set(["null"]),
    lineComments: ["//"],
    blockComments: true,
    stringQuotes: ['"', "'"],
    templateQuotes: true,
    decorators: true
  },
  shell: {
    keywords: shellKeywords,
    commands: shellCommands,
    lineComments: ["#"],
    stringQuotes: ['"', "'"],
    variablePrefix: "$",
    flags: true
  },
  python: {
    keywords: pythonKeywords,
    types: pythonTypes,
    booleans: pythonBooleans,
    nulls: pythonNulls,
    lineComments: ["#"],
    stringQuotes: ['"', "'"],
    tripleStringQuotes: true,
    decorators: true
  },
  sql: {
    keywords: sqlKeywords,
    booleans: new Set(["true", "false"]),
    nulls: new Set(["null"]),
    lineComments: ["--"],
    blockComments: true,
    stringQuotes: ['"', "'"],
    caseInsensitive: true
  },
  ruby: {
    keywords: rubyKeywords,
    booleans: rubyBooleans,
    nulls: rubyNulls,
    lineComments: ["#"],
    stringQuotes: ['"', "'"]
  },
  go: {
    keywords: goKeywords,
    types: goTypes,
    booleans: goBooleans,
    nulls: goNulls,
    lineComments: ["//"],
    blockComments: true,
    stringQuotes: ['"', "'", "`"]
  },
  java: {
    keywords: javaKeywords,
    types: javaTypes,
    booleans: javaBooleans,
    nulls: javaNulls,
    lineComments: ["//"],
    blockComments: true,
    stringQuotes: ['"', "'"],
    decorators: true
  },
  c: {
    keywords: cKeywords,
    types: cTypes,
    booleans: cppBooleans,
    nulls: cppNulls,
    lineComments: ["//"],
    blockComments: true,
    stringQuotes: ['"', "'"]
  },
  cpp: {
    keywords: cppKeywords,
    types: cppTypes,
    booleans: cppBooleans,
    nulls: cppNulls,
    lineComments: ["//"],
    blockComments: true,
    stringQuotes: ['"', "'"]
  },
  csharp: {
    keywords: csharpKeywords,
    types: csharpTypes,
    booleans: cppBooleans,
    nulls: javaNulls,
    lineComments: ["//"],
    blockComments: true,
    stringQuotes: ['"', "'"],
    decorators: true
  },
  rust: {
    keywords: rustKeywords,
    types: rustTypes,
    booleans: rustBooleans,
    nulls: rustNulls,
    lineComments: ["//"],
    blockComments: true,
    stringQuotes: ['"', "'"],
    rustAttributes: true
  },
  php: {
    keywords: phpKeywords,
    types: phpTypes,
    booleans: new Set(["true", "false"]),
    nulls: new Set(["null"]),
    lineComments: ["//", "#"],
    blockComments: true,
    stringQuotes: ['"', "'"],
    variablePrefix: "$"
  }
};

const tokenizers: Readonly<Record<CodeHighlightFamily, CodeTokenizer>> = {
  lexical: tokenizeLexical,
  data: tokenizeData,
  style: tokenizeStyle,
  line: tokenizeLine,
  markup: tokenizeMarkup
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

    if (spec.rustAttributes === true && source.startsWith("#[", index)) {
      index = readUntil(source, index + 2, "]");
      emitter.push("decorator", start, index);
      continue;
    }

    if (spec.decorators === true && char === "@" && isIdentifierStart(source[index + 1] ?? "")) {
      index = readIdentifier(source, index + 1);
      emitter.push("decorator", start, index);
      continue;
    }

    if (spec.variablePrefix === "$" && char === "$" && isIdentifierStart(source[index + 1] ?? "")) {
      index = readIdentifier(source, index + 1);
      emitter.push("variable", start, index);
      continue;
    }

    if (spec.flags === true && char === "-" && isFlagStart(source[index + 1] ?? "")) {
      index = readFlag(source, index + 1);
      emitter.push("flag", start, index);
      continue;
    }

    if (
      spec.tripleStringQuotes === true &&
      (char === '"' || char === "'") &&
      source.startsWith(char.repeat(3), index)
    ) {
      index = readTripleQuotedString(source, index, char);
      emitter.push("string", start, index);
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
  if (language.spec === "toml" || language.spec === "ini") {
    return tokenizeConfig(source);
  }

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

function tokenizeConfig(source: string): CodeToken[] {
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

    index = readSpacesAndTabs(source, index);
    if (index > start) {
      emitter.pushPlain(start, index);
      continue;
    }

    if (source[index] === "#" || source[index] === ";") {
      index = readUntilLineEnd(source, index);
      emitter.push("comment", start, index);
      atLineStart = false;
      continue;
    }

    if (atLineStart && source[index] === "[") {
      index = readUntil(source, index + 1, "]");
      emitter.push("selector", start, index);
      atLineStart = false;
      continue;
    }

    if (atLineStart) {
      const keyEnd = readConfigKey(source, index);
      if (keyEnd > index) {
        emitter.push("key", index, keyEnd);
        index = keyEnd;
        atLineStart = false;
        continue;
      }
    }

    if (source[index] === '"' || source[index] === "'") {
      const quote = source[index]!;
      index = readQuotedString(source, index, quote);
      emitter.push("string", start, index);
      atLineStart = false;
      continue;
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

function tokenizeLine(source: string, language: CodeLanguageInfo): CodeToken[] {
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

    if (atLineStart && language.spec === "diff" && (source[index] === "+" || source[index] === "-")) {
      index = readUntilLineEnd(source, index);
      emitter.push(source[start] === "+" ? "string" : "important", start, index);
      atLineStart = false;
      continue;
    }

    if (atLineStart && language.spec === "markdown" && source[index] === "#") {
      index = readUntilLineEnd(source, index);
      emitter.push("keyword", start, index);
      atLineStart = false;
      continue;
    }

    if (atLineStart && language.spec === "dockerfile") {
      const directiveEnd = readIdentifier(source, index);
      if (directiveEnd > index) {
        emitter.push("directive", index, directiveEnd);
        index = directiveEnd;
        atLineStart = false;
        continue;
      }
    }

    if (source[index] === "#" && language.spec !== "diff") {
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

    index = readNumber(source, index);
    if (index > start) {
      emitter.push("number", start, index);
      atLineStart = false;
      continue;
    }

    emitter.pushPlain(start, start + 1);
    index = start + 1;
    atLineStart = false;
  }

  return emitter.tokens;
}

function tokenizeMarkup(source: string): CodeToken[] {
  const emitter = createEmitter(source);
  let index = 0;

  while (index < source.length) {
    const start = index;

    if (source.startsWith("<!--", index)) {
      index = readUntil(source, index + 4, "-->");
      emitter.push("comment", start, index);
      continue;
    }

    if (source[index] === "<") {
      emitter.push("punctuation", index, index + 1);
      index += 1;
      if (source[index] === "/") {
        emitter.push("punctuation", index, index + 1);
        index += 1;
      }

      const tagStart = index;
      index = readIdentifier(source, index);
      if (index > tagStart) {
        emitter.push("tag", tagStart, index);
      }

      while (index < source.length && source[index] !== ">") {
        const innerStart = index;
        index = readWhitespace(source, index);
        if (index > innerStart) {
          emitter.pushPlain(innerStart, index);
          continue;
        }

        if (source[index] === '"' || source[index] === "'") {
          const quote = source[index]!;
          index = readQuotedString(source, index, quote);
          emitter.push("string", innerStart, index);
          continue;
        }

        index = readIdentifier(source, index);
        if (index > innerStart) {
          emitter.push("attribute", innerStart, index);
          continue;
        }

        emitter.push("punctuation", innerStart, innerStart + 1);
        index = innerStart + 1;
      }

      if (source[index] === ">") {
        emitter.push("punctuation", index, index + 1);
        index += 1;
      }
      continue;
    }

    emitter.pushPlain(start, start + 1);
    index = start + 1;
  }

  return emitter.tokens;
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
  const lookup = spec.caseInsensitive === true ? word.toLowerCase() : word;

  if (spec.booleans?.has(lookup) === true || spec.booleans?.has(word) === true) {
    return "boolean";
  }

  if (spec.nulls?.has(lookup) === true || spec.nulls?.has(word) === true) {
    return "null";
  }

  if (spec.keywords?.has(lookup) === true || spec.keywords?.has(word) === true) {
    return "keyword";
  }

  if (spec.types?.has(lookup) === true || spec.types?.has(word) === true) {
    return "type";
  }

  if (spec.commands?.has(lookup) === true || spec.commands?.has(word) === true) {
    return "command";
  }

  if (spec.constants?.has(lookup) === true || spec.constants?.has(word) === true) {
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

function readTripleQuotedString(source: string, index: number, quote: string): number {
  const marker = quote.repeat(3);
  index += marker.length;

  while (index < source.length) {
    if (source.startsWith(marker, index)) {
      return index + marker.length;
    }

    if (source[index] === "\\") {
      index = Math.min(source.length, index + 2);
      continue;
    }

    index += 1;
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

function readUntil(source: string, index: number, marker: string): number {
  while (index < source.length) {
    if (source.startsWith(marker, index)) {
      return index + marker.length;
    }

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

function readConfigKey(source: string, index: number): number {
  const start = index;
  while (index < source.length) {
    const char = source[index]!;
    if (char === "=" || char === ":") {
      return trimRightIndex(source, start, index);
    }

    if (char === "\n" || char === "#" || char === ";") {
      return start;
    }

    index += 1;
  }

  return start;
}

function readFlag(source: string, index: number): number {
  while (index < source.length && isFlagPart(source[index]!)) {
    index += 1;
  }

  return index;
}

function trimRightIndex(source: string, start: number, end: number): number {
  while (end > start && (source[end - 1] === " " || source[end - 1] === "\t")) {
    end -= 1;
  }

  return end;
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

function isFlagStart(char: string): boolean {
  return isAlpha(char) || char === "-";
}

function isFlagPart(char: string): boolean {
  return isAlpha(char) || isDigit(char) || char === "-";
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
