/** DOCX page dimensions are twips; PDF's default user space is points. */
export function docxPageDimension(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  value = value.trim();
  if (!value || [...value].some(character => character < "0" || character > "9")) throw new Error("Invalid DOCX page dimension");
  const points = Number(value) / 20;
  if (!Number.isFinite(points) || points <= 0 || points > 14400) throw new Error("Invalid DOCX page dimension");
  return points;
}
