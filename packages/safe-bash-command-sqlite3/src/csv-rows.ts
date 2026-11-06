/** The CLI's permissive CSV dialect, retaining only the current record and
 * delimiter lookahead. Quoted newlines and multi-character separators survive
 * arbitrary decoder boundaries. */
export class CsvRows {
  private pending = "";
  private line = 1;
  public rowLine = 1;
  private field = "";
  private row: string[] = [];
  private quoted = false;
  private fieldLine = 1;
  private started = false;
  constructor(private readonly separator: string, private readonly report?: (message: string) => void) {
    if (!separator.length) throw new Error("Import separator must not be empty");
  }
  *push(text: string, final = false): Generator<string[]> {
    const content = this.pending + text;
    let at = 0;
    while (at < content.length) {
      if (!final && content.length - at <= Math.max(2, this.separator.length)) break;
      const char = content[at]!;
      if (this.quoted) {
        if (char === '"') {
          if (content[at + 1] === '"') { this.field += '"'; at += 2; continue; }
          const next = content[at + 1];
          if (next === undefined || next === "\n" ||
              next === "\r" && content[at + 2] === "\n" || content.startsWith(this.separator, at + 1)) {
            this.quoted = false; at++; continue;
          }
          this.report?.(`${this.line}: unescaped " character\n`);
        }
        if (char === "\n") this.line++;
        this.field += char; at++; continue;
      }
      if (char === '"' && !this.field.length) {
        this.quoted = true; this.started = true; this.fieldLine = this.line; at++; continue;
      }
      if (content.startsWith(this.separator, at)) {
        this.row.push(this.field); this.field = ""; this.started = false; at += this.separator.length; continue;
      }
      if (char === "\n" || char === "\r" && content[at + 1] === "\n") {
        this.row.push(this.field); this.field = ""; this.started = false;
        const row = this.row; this.row = []; at += char === "\r" ? 2 : 1;
        this.line++;
        yield row;
        this.rowLine = this.line;
        continue;
      }
      this.field += char; at++;
    }
    this.pending = content.slice(at);
    if (final && this.quoted) {
      this.report?.(`${this.fieldLine}: unterminated "-quoted field\n`);
      this.quoted = false;
    }
    if (final && (this.started || this.field.length || this.row.length)) {
      this.row.push(this.field); this.field = ""; this.started = false;
      const row = this.row; this.row = []; yield row;
    }
  }
}
