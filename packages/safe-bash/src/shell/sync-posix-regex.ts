// Character-class fragments for the sync evaluators' ASCII regex profile.
const classes: Readonly<Record<string, string>> = {
  digit: "0-9", alpha: "A-Za-z", alnum: "A-Za-z0-9",
  upper: "A-Z", lower: "a-z", blank: " \\t",
  space: " \\t\\r\\n\\v\\f", xdigit: "A-Fa-f0-9",
  punct: "!-/:-@\\[-`{-~", cntrl: "\\x00-\\x1f\\x7f",
  graph: "!-~", print: " -~",
};

/** Translate class tokens only inside bracket expressions; defer unsupported syntax. */
export function syncPosixRegexSource(source: string): string | undefined {
  let output = "";
  let inBracket = false;
  let bracketStart = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (char === "\\") {
      output += source.slice(i, i + 2);
      i++;
      continue;
    }
    if (inBracket && char === "[" && source[i + 1] === ":") {
      const end = source.indexOf(":]", i + 2);
      if (end === -1) return undefined;
      const name = source.slice(i + 2, end);
      if (!Object.hasOwn(classes, name)) return undefined;
      output += classes[name];
      i = end + 1;
      continue;
    }
    if (char === "[" && !inBracket) {
      inBracket = true;
      bracketStart = i + 1 + (source[i + 1] === "^" ? 1 : 0);
      // A leading literal ] requires POSIX bracket parsing rather than JS RegExp.
      if (source[bracketStart] === "]") return undefined;
    } else if (char === "]" && inBracket) {
      inBracket = false;
    }
    if (inBracket && char === "[" && (source[i + 1] === "." || source[i + 1] === "=")) return undefined;
    output += char;
  }
  return output;
}
