/** Built-in display names whose stored WordprocessingML names differ. */
const displayNames = ["Caption", "Header", "Footer", "Heading 1", "Heading 2", "Heading 3", "Heading 4", "Heading 5", "Heading 6", "Heading 7", "Heading 8", "Heading 9"];
export function styleDisplayName(name: string): string {
  return displayNames.find(value => value.toLowerCase() === name) ?? name;
}
export function styleStoredName(name: string): string {
  return displayNames.includes(name) ? name.toLowerCase() : name;
}
