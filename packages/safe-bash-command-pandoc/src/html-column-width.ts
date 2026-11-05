const ws = (c: string) => c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f";

export async function htmlColumnWidth(attribute: Iterable<string> | AsyncIterable<string>, style: Iterable<string> | AsyncIterable<string>) {
  // Parse numeric percentages incrementally, keeping attributes in caller storage.
  let n = 0, fraction = 0, decimal = false, digits = false, percent = false, trailing = false, invalid = false;
  const reset = () => {n = 0; fraction = 0; decimal = false; digits = false; percent = false; trailing = false; invalid = false;};
  const accept = (c: string) => {
    if (ws(c)) {if (digits || decimal || percent) trailing = true;}
    else if (trailing || percent) invalid = true;
    else if (c >= "0" && c <= "9") {digits = true; if (decimal) {n += Number(c) * fraction; fraction /= 10;} else n = n * 10 + Number(c);}
    else if (c === "." && !decimal) {decimal = true; fraction = 0.1;}
    else if (c === "%" && digits) percent = true;
    else invalid = true;
  };
  const result = () => !invalid && percent && Number.isFinite(n) ? n / 100 : undefined;
  for await (const chunk of attribute) for (const c of chunk) accept(c);
  let width = result(); reset();
  let property = "", inValue = false;
  const finish = () => {if (property.trim().toLowerCase() === "width") {const parsed = result(); if (parsed !== undefined) width = parsed;} property = ""; inValue = false; reset();};
  for await (const chunk of style) for (const c of chunk) {
    if (c === ";") finish();
    else if (!inValue && c === ":") inValue = true;
    else if (inValue) accept(c);
    else if (!ws(c) || property) {if (property.length < 6) property += c; else if (!ws(c)) property = "invalid";}
  }
  finish(); return width;
}
