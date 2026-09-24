import { stringify } from "./input.js";
import { Budget, JqError, type Json } from "./limits.js";
import { isNumber } from "./numbers.js";

export async function formatValue(name: string, input: Json, budget: Budget): Promise<string> {
  const text = typeof input === "string" ? input : await stringify(input, budget);
  await budget.tick(text.length);
  let result: string;
  switch (name) {
    case "text": result = text; break;
    case "json": result = await stringify(input, budget); break;
    case "base64": result = Buffer.from(text).toString("base64"); break;
    case "base64d": {
      if (typeof input !== "string") throw new JqError("base64d requires a string");
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const raw = input.endsWith("==") ? input.slice(0, -2) : input.endsWith("=") ? input.slice(0, -1) : input;
      if (raw.length % 4 === 1 || [...raw].some(character => !alphabet.includes(character))) throw new JqError("invalid base64 string");
      result = Buffer.from(input, "base64").toString(); break;
    }
    case "uri": {
      result = "";
      for (const byte of Buffer.from(text)) {
        await budget.tick();
        const character = String.fromCharCode(byte);
        result += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~".includes(character) ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
        if (result.length > budget.limits.maxValueBytes) budget.text(result);
      }
      break;
    }
    case "html": {
      const escapes: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&apos;", '"': "&quot;" };
      result = "";
      for (const character of text) { await budget.tick(); result += escapes[character] ?? character; if (result.length > budget.limits.maxValueBytes) budget.text(result); }
      break;
    }
    case "csv":
    case "tsv":
    case "sh": {
      if (name !== "sh" && !Array.isArray(input)) throw new JqError(`${name} requires an array`);
      const values = Array.isArray(input) ? input : [input];
      const fields: string[] = [];
      for (const value of values) {
        await budget.tick();
        if (value !== null && typeof value !== "string" && typeof value !== "boolean" && !isNumber(value)) throw new JqError(`${name} cannot format an object or array`);
        const scalar = typeof value === "string" ? value : await stringify(value, budget);
        if (name === "sh") fields.push(typeof value === "string" ? `'${scalar.split("'").join("'\\''")}'` : scalar);
        else if (value === null) fields.push("");
        else if (name === "csv") fields.push(typeof value === "string" ? `"${scalar.split('"').join('""')}"` : scalar);
        else {
          let field = "";
          const escapes: Readonly<Record<string, string>> = { "\t": "\\t", "\r": "\\r", "\n": "\\n", "\\": "\\\\" };
          for (const character of scalar) { await budget.tick(); field += escapes[character] ?? character; }
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
