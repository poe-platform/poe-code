/** DOCX picture extents are positive integer EMUs (12700 per PDF point). */
export function docxImageDimension(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (value.length > 64) throw new Error("Invalid DOCX image dimension");
  value = value.trim();
  if (!value || [...value].some(character => character < "0" || character > "9")) throw new Error("Invalid DOCX image dimension");
  const points = Number(value) / 12700;
  if (!Number.isFinite(points) || points <= 0) throw new Error("Invalid DOCX image dimension");
  return points;
}
