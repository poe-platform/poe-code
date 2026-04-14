export function shellQuote(value: string): string {
  let quoted = "'";
  for (const char of value) {
    if (char === "'") {
      quoted += `'"'"'`;
      continue;
    }
    quoted += char;
  }
  quoted += "'";
  return quoted;
}
