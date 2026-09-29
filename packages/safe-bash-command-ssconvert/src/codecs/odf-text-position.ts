/** Automatic script positions shared by cell fonts and character styles. */
export function readOdfScriptPosition(source: string | undefined, charge: (amount?: number) => void): -1 | 0 | 1 | undefined {
  if (source === undefined) return undefined;
  charge(source.length);
  let token = "";
  for (const character of source.trim()) { if (" \t\r\n".includes(character)) break; token += character; }
  if (token === "sub") return -1;
  if (token === "super") return 1;
  if (token.length > 1 && token.endsWith("%") && Number(token.slice(0, -1)) === 0) return 0;
  return undefined;
}
