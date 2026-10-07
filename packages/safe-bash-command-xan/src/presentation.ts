import type { ByteSource } from "safe-bash-contracts/io";
import { escapeText } from "safe-bash-contracts/escaping";
import { widthOf } from "safe-bash-command-column/display";
import type { Arguments } from "./argv.js";
import { Budget, XanError } from "./budget.js";
import { cellText, emitted, textRow } from "./cells.js";
import { expressions } from "./expression.js";
import type { InputScope } from "./io.js";
import { parseSelection, resolveSelection } from "./selector.js";
import type { Writer } from "./writer.js";

export async function presentationRows(args: Arguments, scope: InputScope, budget: Budget, writer: Writer): Promise<ByteSource> {
  const scanner = scope.open(args.inputs[0]!, args);
  const first = await scanner.next();
  if (first) scope.own(first.free);
  const table = args.command === "table";
  const source = args.command === "map" ? args.operand! : args.evaluateFile ? await scope.expression(args.selection) : args.selection;
  const projections = table ? [] : await expressions(source, first, args.noHeaders, budget);
  if (args.command === "map" && args.rightSelection !== "__INLINE_MULTI__" && projections.length !== 1) throw new XanError("map requires one expression");
  budget.hold((first?.width ?? 0) * 32);
  const selected = table ? await resolveSelection(await parseSelection(args.selection, budget), first?.cells.map(cell => cell.decoded.view()) ?? [], args.noHeaders, budget) : [];
  const lines: { text: string; width: number }[][] = [], widths = selected.map(() => 0);
  let retained = 0;
  const hold = (size: number): void => { budget.hold(size); retained += size; };
  let row = first;
  return (async function* (): ByteSource {
  try {
    if (!table && !args.noHeaders) {
      yield* textRow(args.command === "map"
        ? [
            ...(first?.cells.map(cell => cell.decoded.view()) ?? []),
            ...(args.rightSelection === "__INLINE_MULTI__" ? projections.map(p => p.name) : [args.rightSelection!]),
          ]
        : projections.map(projection => projection.name), writer, budget);
      first?.free(); row = await scanner.next();
    }
    while (row) {
      if (row.width !== first?.width) throw new XanError("inconsistent field count");
      if (table) {
        hold(selected.length * 64 + 32);
        const line: { text: string; width: number }[] = [];
        for (let i = 0; i < selected.length; i++) {
          const bytes = row.cells[selected[i]!]!.decoded.view();
          hold(bytes.length * 16);
          const value = escapeText(cellText(bytes, budget), "diagnostic");
          let width = 0;
          for (const character of value) { budget.work(); width += widthOf(character.codePointAt(0)!); }
          widths[i] = Math.max(widths[i]!, width);
          line.push({ text: value, width });
        }
        lines.push(line);
      } else {
        const size = row.cells.reduce((sum, cell) => sum + cell.decoded.length * 4, 0) * Math.max(1, projections.length);
        budget.hold(size);
        try {
          const values = projections.map(projection => String(projection.evaluate(row!)));
          yield* textRow(args.command === "map" ? [...row.cells.map(cell => cell.decoded.view()), ...values] : values, writer, budget);
        } finally { budget.release(size); }
      }
      row.free(); row = await scanner.next();
    }
    if (table) {
      const size = widths.reduce((sum, width) => sum + width + 2, 1);
      for (let i = 0; i < lines.length; i++) {
        const textSize = lines[i]!.reduce((sum, value) => sum + value.text.length, 0);
        const temporary = (size + textSize) * 4;
        budget.hold(temporary);
        try {
          budget.work(size); const c = budget.checkpoint(); if (c) await c;
          yield* emitted(await writer.text(lines[i]!.map((value, column) => value.text + " ".repeat(widths[column]! - value.width)).join("  ") + "\n"), budget);
          if (i === 0 && !args.noHeaders) yield* emitted(await writer.text(widths.map(width => "-".repeat(width)).join("  ") + "\n"), budget);
        } finally { budget.release(temporary); }
      }
    }
  } finally { row?.free(); first?.free(); budget.release(retained); await scanner.close(); }
  })();
}
