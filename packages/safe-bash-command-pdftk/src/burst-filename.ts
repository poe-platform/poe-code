export function formatBurstFilename(pattern: string, pageNum: number): string {
  let out = "";
  let replaced = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== "%") {
      out += pattern[i]!;
      continue;
    }
    if (pattern[i + 1] === "%") {
      out += "%";
      i++;
      continue;
    }
    if (!replaced) {
      let j = i + 1;
      let zeroPad = false;
      if (pattern[j] === "0") {
        zeroPad = true;
        j++;
      }
      let widthStr = "";
      while (j < pattern.length && pattern[j]! >= "0" && pattern[j]! <= "9") {
        widthStr += pattern[j]!;
        j++;
      }
      if (pattern[j] === "d") {
        const width = widthStr ? Number.parseInt(widthStr, 10) : 1;
        out += zeroPad ? String(pageNum).padStart(width, "0") : String(pageNum);
        replaced = true;
        i = j;
        continue;
      }
    }
    out += "%";
  }
  return out;
}

