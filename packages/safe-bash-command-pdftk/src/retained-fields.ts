import type { PdfRetainedDocument } from "@poe-code/pdf-ast";

/** Emit one field/value/option at a time; encode bounded chunks without collecting the report. */
export async function* retainedFieldReport(document: PdfRetainedDocument, utf8: boolean, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder(); let work = 0;
  async function* line(prefix: string, value: string | number) {
    let part = prefix;
    for (const char of String(value)) {
      const code = char.codePointAt(0)!; part += !utf8 && code > 127 ? `&#${code};` : char;
      if (part.length >= 4096) { signal.throwIfAborted(); if (++work % 16 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); yield encoder.encode(part); part = ""; }
    }
    signal.throwIfAborted(); yield encoder.encode(part + "\n");
  }
  for await (const field of document.formFieldDetails()) {
    yield encoder.encode("---\n");
    yield* line("FieldType: ", field.type === "checkbox" ? "Button" : field.type === "choice" ? "Choice" : "Text");
    yield* line("FieldName: ", field.name);
    if (field.altName) yield* line("FieldNameAlt: ", field.altName);
    yield* line("FieldFlags: ", field.flags);
    for await (const value of field.values()) yield* line("FieldValue: ", value);
    if (field.defaultValue !== undefined && field.defaultValue !== "") yield* line("FieldValueDefault: ", field.defaultValue);
    yield* line("FieldJustification: ", field.justification);
    for await (const option of field.options()) yield* line("FieldStateOption: ", option);
    if (field.maxLength !== undefined) yield* line("FieldMaxLength: ", field.maxLength);
  }
}
