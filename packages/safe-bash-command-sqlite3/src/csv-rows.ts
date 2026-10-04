/** The CLI's permissive CSV dialect, retaining only the current record and
 * delimiter lookahead. Quoted newlines and multi-character separators survive
 * arbitrary decoder boundaries. */
export class CsvRows {
  private pending = "";
  private field = "";
  private row: string[] = [];
  private quoted = false;
  constructor(private readonly separator: string) {
    if (!separator.length) throw new Error("Import separator must not be empty");
  }
  *push(text: string, final = false): Generator<string[]> {
    const content = this.pending + text;
    let at = 0;
    while (at < content.length) {
      if (!final && content.length - at <= Math.max(1, this.separator.length - 1)) break;
      const char = content[at]!;
      if (this.quoted) {
        if (char === '"') {
          if (content[at + 1] === '"') { this.field += '"'; at += 2; continue; }
          this.quoted = false; at++; continue;
        }
        this.field += char; at++; continue;
      }
      if (char === '"' && !this.field.length) { this.quoted = true; at++; continue; }
      if (content.startsWith(this.separator, at)) {
        this.row.push(this.field); this.field = ""; at += this.separator.length; continue;
      }
      if (char === "\n" || char === "\r" && content[at + 1] === "\n") {
        this.row.push(this.field); this.field = "";
        const row = this.row; this.row = []; at += char === "\r" ? 2 : 1;
        yield row; continue;
      }
      this.field += char; at++;
    }
    this.pending = content.slice(at);
    if (final && (this.field.length || this.row.length)) {
      this.row.push(this.field); this.field = "";
      const row = this.row; this.row = []; yield row;
    }
  }
}
