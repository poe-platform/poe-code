export function isBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  try { return btoa(atob(value)) === value; }
  catch { return false; }
}
