import { CurlError } from "./types.js";

function token(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) || "!#$%&'*+-.^_`|~".includes(character);
}

/** Read MIME parameters until curl's next form attribute, retaining header bytes. */
export function formContentType(input: string, start: number, fileList = false): { value: string; end: number } {
  let end = start;
  const invalid = () => { throw new CurlError(2, "Invalid multipart content type"); };
  const readToken = () => {
    const begin = end;
    while (token(input[end])) end++;
    if (end === begin) invalid();
  };
  const whitespace = () => { while (input[end] === " " || input[end] === "\t") end++; };
  readToken();
  if (input[end++] !== "/") invalid();
  readToken();
  whitespace();
  while (end < input.length) {
    if (fileList && input[end] === ",") break;
    if (input[end] !== ";") invalid();
    const separator = end++;
    whitespace();
    if (["type=", "filename=", "encoder=", "headers="].some(attribute => input.startsWith(attribute, end))) {
      return { value: input.slice(start, separator), end: separator };
    }
    readToken();
    whitespace();
    if (input[end++] !== "=") invalid();
    whitespace();
    if (input[end] === '"') {
      end++;
      let closed = false;
      while (end < input.length) {
        const character = input[end++]!;
        if (character === '"') { closed = true; break; }
        const literal = character === "\\" ? input[end++] : character;
        if (literal === undefined || literal.charCodeAt(0) < 32 || literal.charCodeAt(0) === 127) invalid();
      }
      if (!closed) invalid();
    } else readToken();
    whitespace();
  }
  return { value: input.slice(start, end), end };
}
