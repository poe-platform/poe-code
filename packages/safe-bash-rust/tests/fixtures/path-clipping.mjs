import { readFileSync } from "node:fs";

export const clippingCases = readFileSync(new URL("./path-clipping.txt", import.meta.url), "utf8").trim().split("\n").map(line => {
  const [name, content, probes] = line.split("|");
  return { name, pdf: clippingPdf(content), probes: probes.split(" ").map(p => p.split(",").map(Number)) };
});

export function clippingPdf(content) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> /XObject << /Fm 6 0 R /Im 7 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /Length 44 >>\nstream\n40 40 20 20 re W n 1 0 0 rg 0 0 100 100 re f\nendstream",
    "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nff0000>\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
