/** Same-build ASLR exception: only the pointer in a line-leading log prefix.
 * All diagnostic payload bytes, including malformed UTF-8, remain comparable. */
export function comparableDiagnostics(bytes: Uint8Array): Buffer {
  const lines = Buffer.from(bytes).toString("latin1").split("\n");
  return Buffer.from(lines.map(line => {
    if (!line.startsWith("[")) return line;
    const end = line.indexOf("]");
    const marker = line.indexOf(" @ 0x");
    if (marker < 0 || end < marker) return line;
    const address = line.slice(marker + 5, end);
    if (!address.length || ![...address].every(c => "0123456789abcdefABCDEF".includes(c))) return line;
    return line.slice(0, marker) + " @ <address>" + line.slice(end);
  }).join("\n"), "latin1");
}
