/** Infer ordinary decimal numbers without interpreting dates, hex or non-finite values.
 * Oversized fields stay text so the streaming importer never buffers a whole cell.
 */
export function isCsvNumber(value: string): boolean {
  if (!value.length || value.length >= 4096 || !Number.isFinite(Number(value))) return false;
  let index = 0, digits = 0;
  if (value[index] === "+" || value[index] === "-") index++;
  while (value[index] !== undefined && value[index]! >= "0" && value[index]! <= "9") { index++; digits++; }
  if (value[index] === ".") {
    index++;
    while (value[index] !== undefined && value[index]! >= "0" && value[index]! <= "9") { index++; digits++; }
  }
  if (!digits) return false;
  if (value[index] === "e" || value[index] === "E") {
    index++; digits = 0;
    if (value[index] === "+" || value[index] === "-") index++;
    while (value[index] !== undefined && value[index]! >= "0" && value[index]! <= "9") { index++; digits++; }
    if (!digits) return false;
  }
  return index === value.length;
}
