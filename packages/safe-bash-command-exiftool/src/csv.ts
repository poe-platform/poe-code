import type { MetadataTag } from "./png.js";
import type { Resources } from "./resources.js";

/** Invocation-owned table. CSV values bypass Printable and retain NUL bytes. */
export class CsvTable {
  private readonly headers = new Map<string, { name: string; found: boolean }>();
  private readonly records: { file: string; fields: Map<string, string> }[] = [];
  private sortHeaders = false;

  constructor(private readonly resources: Resources, private readonly missing: boolean,
    names: readonly string[]) {
    for (const name of names) {
      resources.admit("work", name.length * 2 + 1);
      resources.admit("retained", name.length * 4 + 128);
      const key = name.toLowerCase();
      if (key !== "sourcefile" && !this.headers.has(key)) this.headers.set(key, { name, found: missing });
    }
  }

  add(file: string, tags: readonly MetadataTag[]): void {
    this.resources.admit("work", file.length + tags.length);
    this.resources.admit("retained", file.length * 2 + 256);
    const fields = new Map<string, string>();
    for (const tag of tags) {
      this.resources.admit("work", tag.name.length * 2 + tag.value.length + 1);
      this.resources.admit("retained", (tag.name.length + tag.value.length) * 4 + 256);
      const key = tag.name.toLowerCase();
      if (key === "sourcefile") continue;
      if (!this.headers.has(key)) {
        if (this.records.length) this.sortHeaders = true;
        this.headers.set(key, { name: tag.name, found: true });
      } else {
        this.headers.set(key, { name: tag.name, found: true });
      }
      fields.set(key, tag.value);
    }
    this.records.push({ file, fields });
  }

  render(): string {
    const extent = [...this.headers.keys()].reduce((total, key) => total + key.length + 1, 0);
    this.resources.admit("work", extent * (this.headers.size + 1) + this.records.length * (this.headers.size + 1));
    this.resources.admit("retained", this.headers.size * 64 + this.records.length * 32);
    const columns = [...this.headers].filter(([, header]) => header.found);
    if (this.sortHeaders) columns.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const quote = (value: string): string => {
      this.resources.admit("work", value.length * 4 + 1);
      this.resources.admit("retained", value.length * 8 + 16);
      let quoted = false;
      let text = "";
      for (const character of value) {
        if (character === '"') { text += '""'; quoted = true; }
        else text += character;
        if (character === "," || character === "\n" || character === "\r") quoted = true;
      }
      const whitespace = (character: string): boolean => " \t\n\r\f\v\u0085\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000".includes(character);
      if (value.length && (whitespace(value[0]!) || whitespace(value[value.length - 1]!))) quoted = true;
      return quoted ? '"' + text + '"' : text;
    };
    const lines = [["SourceFile", ...columns.map(([, header]) => quote(header.name))].join(",")];
    for (const record of this.records) {
      this.resources.admit("retained", (columns.length + 1) * 16);
      lines.push([quote(record.file), ...columns.map(([key]) => quote(record.fields.get(key) ?? (this.missing ? "-" : "")))].join(","));
    }
    const size = lines.reduce((total, line) => total + line.length + 1, 0);
    this.resources.admit("work", size * 2);
    this.resources.admit("retained", size * 4);
    return lines.join("\n") + "\n";
  }
}
