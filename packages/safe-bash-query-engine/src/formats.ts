import { utf8Encoder, utf8Decoder, encodeBase64, decodeBase64 } from "./bytes.js";
import { stringify } from "./input.js";
import { Budget, JqError, type Json } from "./limits.js";
import { isNumber } from "./numbers.js";

export async function formatValue(name: string, input: Json, budget: Budget): Promise<string> {
  const text = typeof input === "string" ? input : await stringify(input, budget);
  { const _p = budget.tickSync(text.length); if (_p) await _p; }
  let result: string;
  switch (name) {
    case "text": result = text; break;
    case "json": result = await stringify(input, budget); break;
    case "base64": result = encodeBase64(utf8Encoder.encode(text)); break;
    case "base64d": {
      if (typeof input !== "string") throw new JqError("base64d requires a string");
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const raw = input.endsWith("==") ? input.slice(0, -2) : input.endsWith("=") ? input.slice(0, -1) : input;
      if (raw.length % 4 === 1 || [...raw].some(character => !alphabet.includes(character))) throw new JqError("invalid base64 string");
      result = utf8Decoder.decode(decodeBase64(raw)); break;
    }
    case "uri": {
      result = "";
      for (const byte of utf8Encoder.encode(text)) {
        { const _p = budget.tickSync(); if (_p) await _p; }
        const character = String.fromCharCode(byte);
        result += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~".includes(character) ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
        if (result.length > budget.limits.maxValueBytes) budget.text(result);
      }
      break;
    }
    case "urid": {
      if (typeof input !== "string") throw new JqError("urid requires a string");
      try {
        result = decodeURIComponent(input);
      } catch {
        throw new JqError("invalid uri string");
      }
      break;
    }
    case "html": {
      const escapes: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" };
      result = "";
      for (const character of text) { { const _p = budget.tickSync(); if (_p) await _p; } result += escapes[character] ?? character; if (result.length > budget.limits.maxValueBytes) budget.text(result); }
      break;
    }
    case "csv":
    case "tsv":
    case "sh": {
      if (name !== "sh" && !Array.isArray(input)) throw new JqError(`${name} requires an array`);
      const values = Array.isArray(input) ? input : [input];
      const fields: string[] = [];
      for (const value of values) {
        { const _p = budget.tickSync(); if (_p) await _p; }
        if (value !== null && typeof value !== "string" && typeof value !== "boolean" && !isNumber(value)) throw new JqError(`${name} cannot format an object or array`);
        const scalar = typeof value === "string" ? value : await stringify(value, budget);
        if (name === "sh") fields.push(typeof value === "string" ? `'${scalar.split("'").join("'\\''")}'` : scalar);
        else if (value === null) fields.push("");
        else if (name === "csv") fields.push(typeof value === "string" ? `"${scalar.split('"').join('""')}"` : scalar);
        else {
          let field = "";
          const escapes: Readonly<Record<string, string>> = { "\t": "\\t", "\r": "\\r", "\n": "\\n", "\\": "\\\\" };
          for (const character of scalar) { { const _p = budget.tickSync(); if (_p) await _p; } field += escapes[character] ?? character; }
          fields.push(field);
        }
        budget.collection(fields.length);
      }
      result = fields.join(name === "csv" ? "," : name === "tsv" ? "\t" : " "); break;
    }
    default: throw new JqError(`${name} is not a valid format`);
  }
  budget.text(result);
  return result;
}
