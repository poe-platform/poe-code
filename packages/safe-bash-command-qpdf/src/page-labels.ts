import type { RetainedPageLabel } from "@poe-code/pdf-ast";

export function parseQpdfPageLabels(specs: readonly string[], pageCount: number): RetainedPageLabel[] {
  const labels: RetainedPageLabel[] = [];
  for (const spec of specs) {
    const colon = spec.indexOf(":");
    const page = spec.slice(0, colon);
    const digits = page === "z" ? "1" : page.startsWith("r") ? page.slice(1) : page;
    const parts = spec.slice(colon + 1).split("/");
    const style = parts[0] ?? "";
    const number = parts[1] ?? "";
    if (colon <= 0 || digits.length === 0 || [...digits, ...number].some(char => char < "0" || char > "9") ||
        !["", "D", "a", "A", "r", "R"].includes(style)) {
      throw new Error("page label spec must be n:[D|a|A|r|R][/start[/prefix]]");
    }
    for (const operand of [digits, number]) {
      if (operand !== "" && BigInt(operand) > 9223372036854775807n) {
        throw new Error(`overflow/underflow converting ${operand} to 64-bit integer`);
      }
    }
    const index = page === "z" ? pageCount - 1 : page.startsWith("r") ? pageCount - Number(digits) : Number(page) - 1;
    const start = number === "" ? 1 : Number(number);
    if (labels.length === 0 && index !== 0) throw new Error("the first page label specification must start with page 1");
    if (start < 1) throw new Error("starting page number must be >= 1");
    if (labels.length > 0 && index <= labels[labels.length - 1]!.index) {
      throw new Error("page label specifications must be in order by first page");
    }
    labels.push({ index, start, prefix: parts.slice(2).join("/"), ...(style === "" ? {} : { style }) });
  }
  return labels;
}
