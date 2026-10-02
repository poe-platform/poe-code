function asciiLetter(char: string): boolean {
  return char >= "a" && char <= "z" || char >= "A" && char <= "Z";
}

export function iriComponent(value: string, extra: string, query = false): boolean {
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!, point = value.codePointAt(index)!;
    if (char === "%") {
      if (index + 2 >= value.length || !"0123456789abcdefABCDEF".includes(value[index + 1]!) || !"0123456789abcdefABCDEF".includes(value[index + 2]!)) return false;
      index += 2;
      continue;
    }
    if (asciiLetter(char) || char >= "0" && char <= "9" || "-._~!$&'()*+,;=".includes(char) || extra.includes(char)) continue;
    // RFC 3987 §2.2: ucschar, plus iprivate only in iquery.
    const international = point >= 0xa0 && point <= 0xd7ff || point >= 0xf900 && point <= 0xfdcf || point >= 0xfdf0 && point <= 0xffef
      || point >= 0x10000 && point <= 0xefffd && (point & 0xffff) <= 0xfffd && !(point >= 0xe0000 && point < 0xe1000);
    const privateQuery = query && (point >= 0xe000 && point <= 0xf8ff || point >= 0xf0000 && point <= 0xffffd || point >= 0x100000 && point <= 0x10fffd);
    if (!international && !privateQuery) return false;
    if (point > 0xffff) index++;
  }
  return true;
}

function ipLiteral(value: string): boolean {
  const address = value.slice(1, -1);
  if (address[0] === "v" || address[0] === "V") {
    const dot = address.indexOf(".");
    if (dot <= 1 || dot === address.length - 1) return false;
    for (const char of address.slice(1, dot)) if (!"0123456789abcdefABCDEF".includes(char)) return false;
    for (const char of address.slice(dot + 1)) if (!asciiLetter(char) && !(char >= "0" && char <= "9") && !"-._~!$&'()*+,;=:".includes(char)) return false;
    return true;
  }
  for (const char of address) if (!"0123456789abcdefABCDEF:.".includes(char)) return false;
  // URL's IPv6 parser validates the address only; it never acquires a resource.
  try { return new URL(`http://${value}/`).hostname.startsWith("["); } catch { return false; }
}

function iriAuthority(value: string): boolean {
  const at = value.lastIndexOf("@");
  if (at >= 0) {
    if (!iriComponent(value.slice(0, at), ":")) return false;
    value = value.slice(at + 1);
  }
  let port: string | undefined;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0 || !ipLiteral(value.slice(0, end + 1))) return false;
    const suffix = value.slice(end + 1);
    if (suffix && !suffix.startsWith(":")) return false;
    if (suffix) port = suffix.slice(1);
  } else {
    const colon = value.indexOf(":");
    if (!iriComponent(colon < 0 ? value : value.slice(0, colon), "")) return false;
    if (colon >= 0) port = value.slice(colon + 1);
  }
  if (port !== undefined) for (const char of port) if (char < "0" || char > "9") return false;
  return true;
}

/** OPC §3.2.8 uses an absolute IRI, not every xsd:anyURI lexical value. */
export function isAbsoluteRelationshipType(value: string): boolean {
  const colon = value.indexOf(":");
  if (colon < 1 || !asciiLetter(value[0]!)) return false;
  for (const char of value.slice(1, colon)) if (!asciiLetter(char) && !(char >= "0" && char <= "9") && !"+.-".includes(char)) return false;
  const query = value.indexOf("?", colon + 1), hierarchy = value.slice(colon + 1, query < 0 ? undefined : query);
  if (query >= 0 && !iriComponent(value.slice(query + 1), ":@/?", true)) return false;
  if (hierarchy.startsWith("//")) {
    const slash = hierarchy.indexOf("/", 2);
    return iriAuthority(hierarchy.slice(2, slash < 0 ? undefined : slash)) && (slash < 0 || iriComponent(hierarchy.slice(slash), ":@/"));
  }
  return iriComponent(hierarchy, ":@/");
}

/** OPC Target admits an IRI reference, including a retained fragment. */
export function isRelationshipTargetReference(value: string): boolean {
  const hash = value.indexOf("#");
  if (hash >= 0) {
    if (!iriComponent(value.slice(hash + 1), ":@/?")) return false;
    value = value.slice(0, hash);
  }
  const query = value.indexOf("?"), hierarchy = value.slice(0, query < 0 ? undefined : query);
  const colon = hierarchy.indexOf(":"), slash = hierarchy.indexOf("/");
  if (colon >= 0 && (slash < 0 || colon < slash)) return isAbsoluteRelationshipType(value);
  if (query >= 0 && !iriComponent(value.slice(query + 1), ":@/?", true)) return false;
  if (hierarchy.startsWith("//")) {
    const end = hierarchy.indexOf("/", 2);
    return iriAuthority(hierarchy.slice(2, end < 0 ? undefined : end)) && (end < 0 || iriComponent(hierarchy.slice(end), ":@/"));
  }
  return iriComponent(hierarchy, ":@/");
}
