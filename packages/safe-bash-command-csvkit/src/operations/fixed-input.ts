import type { Runtime } from "../runtime.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";
import { readCsvStream } from "../csv.js";
import { integer, repr } from "../cli/parser.js";
import { stripWhitespace } from "../python-text.js";
import { decimalZeroes } from "../unicode-profile.js";

export async function fixedConversion(runtime: Runtime): Promise<number> {
    if (!runtime.options.schema) throw new CsvkitDiagnostic('ValueError: schema must not be null when format is "fixed"');
    const input = runtime.input();
    for (let skipped = 0; skipped < Number(runtime.options.skip_lines ?? 0); skipped++) {
      if (await input.nextLine(false) === null) break;
    }
    const schema = runtime.input(String(runtime.options.schema));
    const records = readCsvStream(schema.lines(), {
      fieldLimit: Number(runtime.options.field_size_limit ?? Infinity), fieldBudget: runtime.context.limits.maxFieldCharacters
    }, runtime.step);
    const first = await records.next();
    if (first.done) throw new CsvkitDiagnostic("StopIteration: ");
    runtime.admitRecord(first.value);
    const indexes = ["column", "start", "length"].map(name => {
      const index = first.value.cells.indexOf(name);
      if (index < 0) throw new CsvkitDiagnostic(`ValueError: A column named "${name}" must exist in the schema file.`);
      return index;
    });
    const fields: { name: string; start: bigint; length: bigint }[] = [];
    let oneBased: boolean | undefined;
    let schemaLine = 1;
    for await (const record of records) {
      runtime.admitRecord(record); schemaLine++;
      // SchemaDecoder evaluates start before accessing column or length.
      const valueAt = (index: number): string => {
        const value = record.cells[indexes[index]!];
        if (value === undefined) throw new CsvkitDiagnostic(`ValueError: Error reading schema at line ${schemaLine}: list index out of range`);
        return value;
      };
      const numberAt = (index: number): bigint => {
        const value = valueAt(index);
        const result = integer(value, Infinity);
        if (result === undefined) throw new CsvkitDiagnostic(`ValueError: Error reading schema at line ${schemaLine}: invalid literal for int() with base 10: ${Array.from(repr(value)).slice(0, 200).join("")}`);
        const digits = Array.from(value).filter(char => decimalZeroes.some(zero => char.codePointAt(0)! >= zero && char.codePointAt(0)! <= zero + 9)).length;
        if (digits > 4300) throw new CsvkitDiagnostic(`ValueError: Error reading schema at line ${schemaLine}: Exceeds the limit (4300 digits) for integer string conversion: value has ${digits} digits; use sys.set_int_max_str_digits() to increase the limit`);
        return BigInt(result);
      };
      const start = numberAt(1);
      oneBased ??= start === 1n;
      const name = valueAt(0);
      const length = numberAt(2);
      if (fields.length >= runtime.context.limits.maxColumns) throw new CsvkitBlocked("column budget exceeded");
      runtime.retain(64 + name.length * 2);
      fields.push({ name, start: start - (oneBased ? 1n : 0n), length });
    }
    await runtime.row(fields.map(field => field.name), {}, false);
    let lineNumber = 0;
    for await (const line of input.lines()) {
      const chars = Array.from(line);
      const row = fields.map(field => { runtime.step(); return stripWhitespace(chars.slice(Number(field.start), Number(field.start + field.length)).join("")); });
      runtime.admitRecord({ cells: row, line: ++lineNumber });
      await runtime.row(row, {}, false);
    }
    return 0;
  }
