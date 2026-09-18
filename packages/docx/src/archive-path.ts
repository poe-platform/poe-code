/** ZIP member names cannot start with a drive letter; later colons are OPC data. */
export function hasArchiveDrivePrefix(name: string): boolean {
  const first = name.charCodeAt(0);
  return name[1] === ":" && ((first >= 65 && first <= 90) || (first >= 97 && first <= 122));
}
