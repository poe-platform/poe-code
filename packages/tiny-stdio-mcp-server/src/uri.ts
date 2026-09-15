const invalidUriCharacters = new Set(["\"", "<", ">", "\\", "^", "`", "{", "|", "}"]);

export function isValidUri(uri: string): boolean {
  for (let index = 0; index < uri.length; index++) {
    const code = uri.charCodeAt(index);
    if (code <= 0x20 || code >= 0x7f || invalidUriCharacters.has(uri[index]!)) return false;
    if (uri[index] === "%") {
      if (index + 2 >= uri.length) return false;
      for (let offset = 1; offset <= 2; offset++) {
        const digit = uri.charCodeAt(index + offset);
        if (!((digit >= 0x30 && digit <= 0x39) || (digit >= 0x41 && digit <= 0x46) || (digit >= 0x61 && digit <= 0x66))) return false;
      }
      index += 2;
    }
  }
  try {
    const parsed = new URL(uri);
    const openingBracket = uri.indexOf("[");
    const closingBracket = uri.indexOf("]");
    if (openingBracket !== -1 || closingBracket !== -1) {
      const schemeEnd = uri.indexOf(":");
      if (!uri.startsWith("//", schemeEnd + 1) || !parsed.hostname.startsWith("[")) return false;
      const authorityStart = schemeEnd + 3;
      let authorityEnd = authorityStart;
      while (authorityEnd < uri.length && !"/?#".includes(uri[authorityEnd]!)) authorityEnd++;
      const authority = uri.slice(authorityStart, authorityEnd);
      if (openingBracket !== authorityStart + authority.lastIndexOf("@") + 1 ||
          closingBracket >= authorityEnd || uri.indexOf("[", openingBracket + 1) !== -1 ||
          uri.indexOf("]", closingBracket + 1) !== -1) return false;
    }
    return true;
  } catch {
    return false;
  }
}
