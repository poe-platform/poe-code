import { QpdfJsonDocument, type ApplyQpdfJsonOptions, type PdfFileSource } from "@poe-code/pdf-ast";

type SyntaxArguments = Parameters<NonNullable<ApplyQpdfJsonOptions["syntaxError"]>>;
class JsonSyntaxFailure extends Error {
  constructor(readonly details: SyntaxArguments) { super(details[1]); }
}

/** Replay only for diagnostics; keep a fixed window, never the whole input. */
async function syntaxMessage(source: PdfFileSource, failure: JsonSyntaxFailure, signal: AbortSignal): Promise<string> {
  const [offset, message, , state] = failure.details;
  let length = 0, line = 1, column = 1, previous = "", prefix = "", window = "", character = "";
  const decoder = new TextDecoder();
  const accept = (text: string) => {
    for (let index = 0; index < text.length; index++) {
      const char = text[index]!;
      if (length < 20) prefix += char;
      if (length >= Math.max(0, offset - 10) && length < offset + 10) window += char;
      if (length === offset) character = char;
      if (length < offset) {
        if (char === "\r" || (char === "\n" && previous !== "\r")) { line++; column = 1; }
        else if (char !== "\n" || previous !== "\r") column++;
        previous = char;
      }
      length++;
    }
  };
  for await (const bytes of source.stream(0, source.size, signal)) accept(decoder.decode(bytes, { stream: true }));
  accept(decoder.decode());
  const at = (stem: string) => `${stem} at position ${offset} (line ${line} column ${column})`;
  if (message === "Invalid JSON Unicode escape" || (state?.token === "string" && state.hex)) return at("Bad Unicode escape in JSON");
  if (message === "Invalid JSON escape") return at("Bad escaped character in JSON");
  if (message === "Invalid JSON string control") return at("Bad control character in string literal in JSON");
  if (message === "Incomplete JSON number") return at(state?.number === "minus" ? "No number after minus sign in JSON" : state?.number === "dot" ? "Unterminated fractional number in JSON" : "Exponent part is missing a number in JSON");
  if (state?.number === "zero" && previous === "0" && character >= "0" && character <= "9") return at("Unexpected number in JSON");
  if (message === "Unexpected trailing JSON") return at("Unexpected non-whitespace character after JSON");
  if (message === "Expected JSON colon" || (!state?.token && state?.mode === "colon")) return at("Expected ':' after property name in JSON");
  if (message === "Expected JSON comma") return at(state?.container === "array" ? "Expected ',' or ']' after array element in JSON" : "Expected ',' or '}' after property value in JSON");
  if (!state?.token && (state?.mode === "key" || state?.mode === "keyFirst")) return at(state.mode === "key" ? "Expected double-quoted property name in JSON" : "Expected property name or '}' in JSON");
  if (length === offset) {
    if (state?.token === "string" && !state.escape) return at("Unterminated string in JSON");
    return "Unexpected end of JSON input";
  }
  if (length <= 20 && ["undefined", "NaN", "Infinity", "[object Object]"].includes(prefix)) return `"${prefix}" is not valid JSON`;
  const excerpt = length <= 20 ? `"${prefix}"` : `${offset >= 10 ? "..." : ""}"${window}"${offset + 10 < length ? "..." : ""}`;
  return `Unexpected token '${character}', ${excerpt} is not valid JSON`;
}

export async function applyJsonInput(owner: QpdfJsonDocument, source: PdfFileSource, options: ApplyQpdfJsonOptions, signal: AbortSignal): Promise<void> {
  try {
    await owner.apply(source.stream(0, source.size, signal), { ...options, syntaxError: (...details) => { throw new JsonSyntaxFailure(details); } });
  } catch (error) {
    if (error instanceof JsonSyntaxFailure) throw new SyntaxError(await syntaxMessage(source, error, signal));
    throw error;
  }
}
