function pipeCells(line: string): string[] | undefined {
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (char === "\\" && line[index + 1] === "|") {
      cell += "|";
      index++;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  if (cells.length === 0) return;
  cells.push(cell.trim());
  if (line.trimStart().startsWith("|")) cells.shift();
  if (line.trimEnd().endsWith("|") && cells.at(-1) === "") cells.pop();
  return cells;
}

/** Extract pipe tables, omitting surrounding prose and alignment delimiter rows. */
export function parseMarkdownTableRows(source: string): string[][] {
  const lines = source.split("\n");
  const rows: string[][] = [];
  for (let index = 0; index + 1 < lines.length; index++) {
    const header = pipeCells(lines[index]!);
    const delimiter = pipeCells(lines[index + 1]!);
    if (!header?.length || delimiter?.length !== header.length || !delimiter.every(cell => {
      const dashes = cell.slice(cell.startsWith(":") ? 1 : 0, cell.endsWith(":") ? -1 : undefined);
      return dashes.length > 0 && [...dashes].every(char => char === "-");
    })) continue;
    rows.push(header);
    index += 2;
    for (; index < lines.length; index++) {
      const cells = pipeCells(lines[index]!);
      if (!cells) break;
      rows.push(header.map((_, column) => cells[column] ?? ""));
    }
  }
  return rows;
}
