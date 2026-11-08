import { expect, it } from "vitest";
import * as api from "./index.js";
import { styleDeclarationFixture } from "../tests/fixtures/style-declarations.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const methods = ["default", "get_by_id", "get_style_id", "add_style"] as const;
function invoke(styles: api.Styles, method: typeof methods[number], value: unknown) {
  return Reflect.apply(styles[method], styles, method === "default" ? [value] : method === "add_style" ? ["Created é 日本", value] : [null, value]);
}
const boundaries = ["string", "number", "undefined", "array", "missing", "extra", "symbol", "prototype", "enum-getter", "name-getter", "wrong-family", "unknown-family", "unknown-name"] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const method of methods) for (const boundary of boundaries)
    it(`validates inert style type before ${method}: ${boundary}; ${kind}; strict=${strict}`, async () => {
      const { input, memory } = await styleDeclarationFixture(strict, kind, "single");
      const doc = await api.Document(input, textContext), styles = doc.styles, before = styles.part.blob;
      let getterCalls = 0;
      const token = { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" };
      const value: unknown = boundary === "string" ? "PARAGRAPH" : boundary === "number" ? 1 : boundary === "undefined" ? undefined : boundary === "array" ? [token] : boundary === "missing" ? { enum: "WD_STYLE_TYPE" } : boundary === "extra" ? { ...token, extra: true } : boundary === "symbol" ? { ...token, [Symbol("original")]: true } : boundary === "prototype" ? Object.assign(Object.create({ inherited: true }) as object, token) : boundary === "enum-getter" ? { get enum() { getterCalls++; return "WD_STYLE_TYPE"; }, name: "PARAGRAPH" } : boundary === "name-getter" ? { enum: "WD_STYLE_TYPE", get name() { getterCalls++; return "PARAGRAPH"; } } : boundary === "wrong-family" ? api.WD_PARAGRAPH_ALIGNMENT.CENTER : boundary === "unknown-family" ? { enum: "ORIGINAL_UNKNOWN", name: "PARAGRAPH" } : { enum: "WD_STYLE_TYPE", name: "ORIGINAL_UNKNOWN" };
      let error: unknown;
      try { invoke(styles, method, value); } catch (caught) { error = caught; }
      expect(getterCalls).toBe(0);
      expect(error).toBeInstanceOf(boundary === "unknown-family" || boundary === "unknown-name" ? api.InvalidValueError : api.InputTypeError);
      expect(error).toHaveProperty("code", "usage");
      expect(styles.part.blob).toEqual(before);
      await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
      expect(readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer))).toEqual(readPackage(input));
      expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
    });

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
  for (const method of methods) for (const name of ["PARAGRAPH", "CHARACTER", "TABLE", "LIST"] as const)
    for (const representation of ["owned", "plain", "null-prototype"] as const)
      it(`retains ${representation} ${name} type semantics at ${method}; ${kind}; strict=${strict}`, async () => {
        const { input, memory } = await styleDeclarationFixture(strict, kind, "single");
        const doc = await api.Document(input, textContext), styles = doc.styles;
        const value = representation === "owned" ? api.WD_STYLE_TYPE[name] : representation === "plain" ? { enum: "WD_STYLE_TYPE", name } : Object.assign(Object.create(null) as object, { enum: "WD_STYLE_TYPE", name });
        const result = invoke(styles, method, value);
        if (method === "get_style_id" || name === "LIST" && method !== "add_style") expect(result).toBeNull();
        else expect(result).toHaveProperty("type", api.WD_STYLE_TYPE[name]);
        await doc.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
        const after = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer)), before = readPackage(input);
        expect([...after.keys()]).toEqual([...before.keys()]);
        for (const [part, bytes] of before) if (method !== "add_style" || part !== "word/styles.xml") expect(after.get(part)).toEqual(bytes);
        expect(doc.paragraphs[0]!.text).toBe("Retain é 日本 עברית 🌊");
        expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
      });
