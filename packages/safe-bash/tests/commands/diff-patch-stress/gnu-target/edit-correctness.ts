import assert from "node:assert/strict";

const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/gu) ?? [];

export function verifyIndependentEdit(before: string, after: string, delta: string, format: "normal" | "context") {
  const original = lines(before);
  const revised = lines(after);
  const removed = new Set<number>();
  const added = new Set<number>();
  const rows = lines(delta);
  let side: "old" | "new" | undefined;
  let oldIndex = 0;
  let newIndex = 0;
  let bodyRows = 0;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const contextOld = /^\*\*\* (\d+)(?:,(\d+))? \*\*\*\*\n$/u.exec(row);
    const contextNew = /^--- (\d+)(?:,(\d+))? ----\n$/u.exec(row);
    const normal = /^(\d+)(?:,(\d+))?([acd])(\d+)(?:,(\d+))?\n$/u.exec(row);
    if (format === "context" && contextOld) { side = "old"; oldIndex = Number(contextOld[1]) - 1; }
    else if (format === "context" && contextNew) { side = "new"; newIndex = Number(contextNew[1]) - 1; }
    else if (format === "normal" && normal) { oldIndex = Number(normal[1]) - 1; newIndex = Number(normal[4]) - 1; }
    else if (format === "context" && /^[ !+-] /u.test(row) || format === "normal" && /^[<>] /u.test(row)) {
      const currentSide = format === "normal" ? row[0] === "<" ? "old" : "new" : side;
      assert(currentSide, "body must follow a range");
      const position = currentSide === "old" ? oldIndex++ : newIndex++;
      const input = currentSide === "old" ? original : revised;
      let text = row.slice(2);
      if (rows[index + 1] === "\\ No newline at end of file\n") { text = text.slice(0, -1); index++; }
      assert.equal(input[position], text, `independent ${currentSide} range/body mismatch at ${position + 1}`);
      bodyRows++;
      if (format === "normal" || row[0] !== " ") {
        const edits = currentSide === "old" ? removed : added;
        assert(!edits.has(position), "duplicate edited coordinate");
        edits.add(position);
      }
    }
  }
  if (before !== after) assert(bodyRows > 0, "changed inputs require an edit body");
  assert.deepEqual(original.filter((_, index) => !removed.has(index)), revised.filter((_, index) => !added.has(index)), "independently retained lines must match in order");
  let previous = new Uint32Array(revised.length + 1);
  for (const originalLine of original) {
    const current = new Uint32Array(revised.length + 1);
    for (let index = 1; index <= revised.length; index++) current[index] = originalLine === revised[index - 1]
      ? previous[index - 1]! + 1 : Math.max(previous[index]!, current[index - 1]!);
    previous = current;
  }
  assert.equal(removed.size + added.size, original.length + revised.length - 2 * previous[revised.length]!, "independent LCS minimum insertion/deletion cost");
}
