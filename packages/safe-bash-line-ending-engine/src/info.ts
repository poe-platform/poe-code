import { LineEndingError, type ConversionOptions, type Direction } from "./internal.js";
import { Lifecycle, Reader } from "./io.js";
import { encodingLabels, readEncoding } from "./encoding.js";

export class FileInformation {
  readonly flags = new Set<string>();
  private headerDone = false;
  constructor(private readonly life: Lifecycle) {}
  configure(value: string): void {
    for (const flag of value) {
      if (!"0dumbtechp".includes(flag)) throw new LineEndingError(`wrong flag '${flag}' for option -i or --info`);
      this.flags.add(flag);
    }
    if (![...value].some(flag => "dumbtec".includes(flag))) for (const flag of "dumbt") this.flags.add(flag);
  }
  async print(direction: Direction, reader: Reader, options: ConversionOptions, filename: string): Promise<void> {
    if (options.verbose && options.assume !== "bytes") await this.life.diagnostic(`${direction}: Assuming UTF-16${options.assume === "le" ? "LE" : "BE"} encoding.\n`);
    const input = await readEncoding(reader);
    if (input.error) {
      if (!options.quiet) await this.life.diagnostic(`${direction}: can not read from input file: Success\n`);
      return;
    }
    const bom = encodingLabels[input.bom];
    const encoding = input.bom === "bytes" ? options.assume : input.bom === "le" || input.bom === "be" ? input.bom : "bytes";
    const byte = input.byte;
    let dos = 0, unix = 0, mac = 0, previous = -1, last = "noeol", binary = false;
    for (;;) {
      const b1 = byte();
      let current = typeof b1 === "number" ? b1 : await b1;
      if (current === -1) break;
      if (encoding !== "bytes") {
        const b2 = byte();
        const trail = typeof b2 === "number" ? b2 : await b2;
        if (trail === -1) break;
        current = encoding === "le" ? current + trail * 256 : current * 256 + trail;
      }
      if (current < 32 && ![9, 10, 12, 13].includes(current)) binary = true;
      if (current === 13) { mac++; last = "mac"; }
      else if (current === 10 && previous === 13) { dos++; mac--; last = "dos"; }
      else if (current === 10) { unix++; last = "unix"; }
      else last = "noeol";
      previous = current;
    }
    const flags = this.flags;
    if (flags.has("c") && (binary && !options.force || (direction === "dos2unix" ? dos : unix) === 0 && (!options.addEol || last === (direction === "dos2unix" ? "unix" : "dos")))) return;
    const eol = flags.has("e") || options.addEol && !flags.has("c");
    const fields = ["d", "u", "m", "b", "t", "e"].filter(flag => flag === "e" ? eol : flags.has(flag));
    const separator = fields.length ? "  " : "";
    const terminator = flags.has("0") ? "\0" : "\n";
    if (flags.has("p")) filename = filename.slice(Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\")) + 1);
    let text = "";
    if (flags.has("h") && !this.headerDone) {
      const labels: Record<string, string> = { d: "     DOS", u: "    UNIX", m: "     MAC", b: "  BOM     ", t: "  TXTBIN", e: " LASTLN" };
      text += fields.map(field => labels[field]).join("") + (filename ? `${separator}FILE` : "") + terminator;
      this.headerDone = true;
    }
    const values: Record<string, string> = {
      d: `  ${String(dos).padStart(6)}`, u: `  ${String(unix).padStart(6)}`, m: `  ${String(mac).padStart(6)}`,
      b: `  ${bom.padEnd(8)}`, t: binary ? "  binary" : "  text  ", e: ` ${last.padEnd(5)} `,
    };
    text += fields.map(field => values[field]).join("") + (filename ? separator + filename : "") + terminator;
    const budget = this.life.budget;
    budget.check(text.length * 3, budget.limits.maxBufferedBytes, "information buffer bytes");
    const bytes = new TextEncoder().encode(text);
    budget.emitted(bytes.length);
    await this.life.stdout(bytes);
  }
}
