import type {ExecutionContext} from "./execution.js";
import type {InputSource, MetadataValue, SerializedDocument, WriteOptions} from "./types.js";

/** Local templates use the same byte/work/output ceilings as document conversion. */
export class LocalTemplate {
  private template: string | undefined;
  private readonly includes: Record<string, string> = {};
  constructor(private readonly context: ExecutionContext, private readonly options: WriteOptions) {}
  async acquire(): Promise<void> {
    const text = async (input: InputSource) => {
      this.context.charge("includes", 1);
      const bytes = await this.context.acquire("bytes" in input ? [input.bytes] : input.chunks, "resourceBytes");
      return this.context.decodeUtf8([bytes]);
    };
    if (this.options.template) this.template = await text(this.options.template);
    for (const [key, sources] of Object.entries({"header-includes": this.options.includeInHeader, "include-before": this.options.includeBeforeBody, "include-after": this.options.includeAfterBody})) {
      const parts: string[] = [];
      for (const source of sources ?? []) parts.push(await text(source));
      this.includes[key] = parts.join("");
    }
  }
  async render(serialized: SerializedDocument): Promise<SerializedDocument> {
    if (serialized.kind !== "text") return serialized;
    const c = this.context;
    let body = serialized.text;
    const before = this.includes["include-before"] ?? "", after = this.includes["include-after"] ?? "", header = this.includes["header-includes"] ?? "";
    if (this.template === undefined) {
      if (!before && !after && !header) return serialized;
      if (body.includes("<body>")) body = body.replace("<body>\n", `<body>\n${before}`).replace("</body>", `${after}</body>`).replace("</head>", `${header}</head>`);
      else body = before + body + after;
      c.charge("retainedBytes", body.length * 2);
      return {kind: "text", text: body};
    }
    const values: Record<string, MetadataValue> = {...this.options.variables, ...this.includes, body: before + body + after};
    const stringify = (value: MetadataValue | undefined): string => value === undefined || value === null ? "" : Array.isArray(value) ? value.map(stringify).join("") : typeof value === "object" ? c.fail("E_UNSUPPORTED_FEATURE", "Template map interpolation is unsupported") : String(value);
    const render = async (start: number, end: number, bindings: Record<string, MetadataValue>, depth: number): Promise<string> => {
      c.bound("depth", depth);
      const parts: string[] = []; let length = 0;
      const append = (part: string) => {length += part.length; c.bound("outputBytes", length); c.charge("retainedBytes", part.length * 2); parts.push(part);};
      for (let i = start; i < end;) {
        await c.cooperate();
        const open = this.template!.indexOf("$", i);
        if (open < 0 || open >= end) {append(this.template!.slice(i, end)); break;}
        append(this.template!.slice(i, open));
        const close = this.template!.indexOf("$", open + 1);
        if (close < 0 || close >= end) c.fail("E_PARSE", "Unclosed template interpolation");
        const token = this.template!.slice(open + 1, close);
        i = close + 1;
        if (!token) {append("$"); continue;}
        const loop = token.startsWith("for(") && token.endsWith(")"), condition = token.startsWith("if(") && token.endsWith(")");
        if (loop || condition) {
          const key = token.slice(loop ? 4 : 3, -1);
          let nesting = 1, cursor = i, alternate = -1, finish = -1, finishEnd = -1;
          while (cursor < end) {
            await c.cooperate();
            const a = this.template!.indexOf("$", cursor), b = this.template!.indexOf("$", a + 1);
            if (a < 0 || b < 0 || b >= end) break;
            const t = this.template!.slice(a + 1, b);
            if (t.startsWith("if(") || t.startsWith("for(")) nesting++;
            if (t === "endif" || t === "endfor") {if (--nesting === 0) {if (t !== (loop ? "endfor" : "endif")) c.fail("E_PARSE", "Mismatched template block"); finish = a; finishEnd = b + 1; break;}}
            if (t === "else" && nesting === 1) alternate = a;
            cursor = b + 1;
          }
          if (finish < 0) c.fail("E_PARSE", "Unclosed template block");
          const value = bindings[key];
          if (loop) {
            if (alternate >= 0) c.fail("E_UNSUPPORTED_FEATURE", "Template loop separators are unsupported");
            for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) append(await render(i, finish, {...bindings, [key]: item}, depth + 1));
          } else if (value && (!Array.isArray(value) || value.length)) append(await render(i, alternate < 0 ? finish : alternate, bindings, depth + 1));
          else if (alternate >= 0) append(await render(alternate + 6, finish, bindings, depth + 1));
          i = finishEnd;
        } else {
          if (["else", "endif", "endfor", "sep"].includes(token) || [...token].some(ch => !(ch >= "a" && ch <= "z") && !(ch >= "A" && ch <= "Z") && !(ch >= "0" && ch <= "9") && !"_-".includes(ch))) c.fail("E_UNSUPPORTED_FEATURE", `Unsupported template expression: ${token}`);
          const value = stringify(bindings[token]);
          // A body followed by a template newline occupies one line ending.
          append(token === "body" && this.template![i] === "\n" && value.endsWith("\n") ? value.slice(0, -1) : value);
        }
      }
      c.charge("retainedBytes", length * 2);
      return parts.join("");
    };
    return {kind: "text", text: await render(0, this.template.length, values, 0)};
  }
}
