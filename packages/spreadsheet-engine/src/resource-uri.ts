/** POSIX virtual identity only: never consult process.cwd or a host filesystem. */
export function resourceUri(name: string, cwd: string): string {
  const colon = name.indexOf(":");
  if (colon > 0 && name.slice(0, colon).split("").every((character, index) =>
    (character >= "A" && character <= "Z") || (character >= "a" && character <= "z") ||
    (index > 0 && ((character >= "0" && character <= "9") || "+-.".includes(character))))) return name;
  const parts: string[] = [];
  for (const part of (name.startsWith("/") ? name : `${cwd}/${name}`).split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "" && part !== ".") parts.push(part);
  }
  return `file:///${parts.map((part) => Array.from(part, (character) =>
    "!$&'()*+,=:@".includes(character) ? character : encodeURIComponent(character)).join("")).join("/")}`;
}
