import { type CommandDefinition, type CommandResult } from "../../contracts/index.js";
import { cell, decode, fields, validateScalar, whitespace, type Cell } from "./display.js";
import { ColumnInputs, diagnostics, type ColumnBudget } from "./internal.js";
import { helpText, parse, settings, usage, type ColumnCommandsOptions, type ParsedOptions } from "./options.js";
import { configuredTable } from "./layout.js";

async function fillOutput(rows: readonly Cell[][], options: ParsedOptions, budget: ColumnBudget): Promise<void> {
  let maximum = 0;
  for (const row of rows) { await budget.step(); maximum = Math.max(maximum, row[0]!.width); }
  const stride = (Math.floor(maximum / 8) + 1) * 8;
  const columns = Math.max(1, Math.min(rows.length, Math.floor(options.width / stride)));
  const height = Math.ceil(rows.length / columns);
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    for (let columnIndex = 0; columnIndex < columns; columnIndex++) {
      await budget.step();
      const index = options.across ? rowIndex * columns + columnIndex : columnIndex * height + rowIndex;
      if (index >= rows.length) break;
      const entry = rows[index]![0]!;
      await budget.text(entry.text);
      const next = options.across ? index + 1 : index + height;
      if (columnIndex + 1 < columns && next < rows.length) {
        await budget.padding(stride / 8 - Math.floor(entry.width / 8), "\t");
      }
    }
    await budget.text("\n");
  }
}

export function createColumnCommand(options: ColumnCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "column", description: "Bounded UTF-8 table and list column layout", async execute(context) {
    context.signal.throwIfAborted();
    const diagnostic = diagnostics(context, limits.maxDiagnosticBytes);
    let inputs: ColumnInputs | undefined, failed = false, reporting = false;
    let result: CommandResult = { exitCode: 0 };
    let rejection: { error: unknown } | undefined;
    try {
      try {
        const parsed = parse(context.args, limits);
        inputs = new ColumnInputs(context, limits);
        const budget = inputs.budget;
        if (parsed.help) await budget.text(helpText);
        else {
          const hideUnnamed = parsed.selectors.hide.split(",").includes("-");
          for (const character of parsed.outputSeparator) { await budget.step(); validateScalar(character); }
          if (parsed.separator) for (const character of parsed.separator) { await budget.step(); validateScalar(character, true); }
          const rows: Cell[][] = [], widths: number[] = [];
          // Only unconditional separators provide a safe output lower bound;
          // hidden/reordered and JSON tables remain bounded by retention caps.
          const separatorBytes = parsed.table && !parsed.json && !parsed.order
            && !parsed.selectors.hide && !parsed.definitions.some(definition => definition.flags.includes("hide"))
            ? Buffer.byteLength(parsed.outputSeparator) : undefined;
          let rowCount = 0, cellCount = 0, exitCode = 0;
          for (const file of parsed.files) {
            await budget.step();
            let reader;
            try { reader = await inputs.open(file); }
            catch (error) {
              inputs.signal.throwIfAborted();
              reporting = true;
              await diagnostic(error);
              reporting = false;
              exitCode = 1;
              continue;
            }
            while (true) {
              const bytes = await reader.next();
              if (bytes === undefined) break;
              budget.check(++rowCount, limits.maxRows, "rows");
              await budget.work(bytes.length);
              const text = decode(bytes);
              let empty = !text.length;
              if (parsed.keepEmpty && !empty) {
                empty = true;
                for (const character of text) { await budget.step(); if (!whitespace(character)) { empty = false; break; } }
              }
              if (empty) {
                if (parsed.keepEmpty) {
                  if (separatorBytes !== undefined) budget.project(1);
                  if (parsed.table) rows.push([]);
                  else {
                    budget.check(++cellCount, limits.maxCells, "cells");
                    budget.retain(0);
                    rows.push([{ text: "", width: 0 }]);
                  }
                }
                continue;
              }
              const values = parsed.table ? await fields(text, parsed.separator, budget, limits.maxCells - cellCount, parsed.columnLimit, separatorBytes) : [text];
              if (parsed.table && !values.length) {
                if (parsed.keepEmpty) rows.push([]);
                continue;
              }
              if (!parsed.table) {
                let blank = true;
                for (const character of text) { await budget.step(); if (character !== " " && character !== "\t") blank = false; }
                if (blank) continue;
              }
              budget.check(values.length, limits.maxCells - cellCount, "cells");
              if (!parsed.table) budget.retain(text.length);
              if (parsed.json && values.length > parsed.names.length && !hideUnnamed) {
                usage(`line ${rows.length + 1}: for JSON the name of the column ${parsed.names.length + 1} is required`);
              }
              cellCount += values.length;
              const row: Cell[] = [];
              for (let index = 0; index < values.length; index++) {
                const entry = await cell(values[index]!, budget);
                row.push(parsed.json ? { text: values[index]!, width: entry.width } : entry);
                widths[index] = Math.max(widths[index] ?? 0, entry.width);
              }
              rows.push(row);
            }
          }
          if (parsed.table) {
            if (rows.length && !widths.length && !parsed.names.length) exitCode = 1;
            else await configuredTable(rows, widths, parsed, budget, limits.maxCells - cellCount);
          }
          else if (rows.length) await fillOutput(rows, parsed, budget);
          result = { exitCode };
        }
      } catch (error) {
        failed = true;
        context.signal.throwIfAborted();
        if (reporting) throw error;
        await diagnostic(error);
        result = { exitCode: 1 };
      }
    } catch (error) {
      rejection = { error };
    }
    if (inputs) {
      let cleanupFailure: { error: unknown } | undefined;
      try { await inputs.close(); }
      catch (error) { cleanupFailure = { error }; }
      context.signal.throwIfAborted();
      if (cleanupFailure && !failed) throw cleanupFailure.error;
    }
    if (rejection) throw rejection.error;
    return result;
  } };
}
