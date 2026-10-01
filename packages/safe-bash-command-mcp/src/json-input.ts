/** Parse JSON while rejecting numeric tokens that native JSON.parse would destroy. */
export function parseArgumentJson(input: string): unknown {
  const value: unknown = JSON.parse(input);
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === "\\") index++;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char !== "-" && (char < "0" || char > "9")) continue;
    const start = index;
    while (index + 1 < input.length) {
      const next = input[index + 1];
      if ((next >= "0" && next <= "9") || ".eE+-".includes(next)) index++;
      else break;
    }
    const token = input.slice(start, index + 1);
    const number = Number(token);
    if (!Number.isFinite(number)) throw new Error("JSON number must be finite");
    if (!token.includes(".") && !token.includes("e") && !token.includes("E") && BigInt(number) !== BigInt(token))
      throw new Error("JSON integer cannot be represented exactly; supply a schema-declared string for an exact ID");
  }
  return value;
}
