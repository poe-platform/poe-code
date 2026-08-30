import { type CommandDefinition, type CommandResult } from "../../contracts/index.js";
import { cell, decode, fields, validateScalar, type Cell } from "./display.js";
import { ColumnInputs, diagnostics, type ColumnBudget } from "./internal.js";
import { helpText, parse, settings, type ColumnCommandsOptions, type ParsedOptions } from "./options.js";
import { tableOutput } from "./table.js";

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
          for (const character of parsed.outputSeparator) { await budget.step(); validateScalar(character); }
          if (parsed.separator) for (const character of parsed.separator) { await budget.step(); validateScalar(character, true); }
          const rows: Cell[][] = [], widths: number[] = [];
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
              if (!text.length) continue;
              const values = parsed.table ? await fields(text, parsed.separator, budget, limits.maxCells - cellCount) : [text];
              if (parsed.table && !values.length) continue;
              if (!parsed.table) {
                let blank = true;
                for (const character of text) { await budget.step(); if (character !== " " && character !== "\t") blank = false; }
                if (blank) continue;
              }
              budget.check(values.length, limits.maxCells - cellCount, "cells");
              cellCount += values.length;
              const row: Cell[] = [];
              for (let index = 0; index < values.length; index++) {
                const entry = await cell(values[index]!, budget);
                row.push(entry);
                widths[index] = Math.max(widths[index] ?? 0, entry.width);
              }
              rows.push(row);
            }
          }
          if (parsed.table) await tableOutput(rows, widths, parsed.outputSeparator, budget);
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
