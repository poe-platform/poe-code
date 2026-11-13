import { readFileSync } from "node:fs";
export function shadingPdf(content, settings) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Shading << /Blend 5 0 R >> /XObject << /Fm 7 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /ShadingType 2 /ColorSpace /DeviceRGB /Function 6 0 R ${settings} >>`,
    "<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>",
    "<< /Type /XObject /Subtype /Form /BBox [20 20 80 80] /Matrix [0.5 0 0 0.5 25 25] /Resources << /Shading << /Blend 5 0 R >> >> /Length 9 >>\nstream\n/Blend sh\nendstream",
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
export const shadingCases = [
  { name: "attached gradient", pdf: readFileSync(new URL("./axial-shading.pdf", import.meta.url)), probes: [[10,50,230,0,25], [50,50,128,0,128], [90,50,26,0,229]] },
  ...readFileSync(new URL("./axial-shading.txt", import.meta.url), "utf8").trim().split("\n").map(line => {
    const [name, content, settings, probes] = line.split("|");
    return { name, pdf: shadingPdf(content, settings), probes: probes.split(" ").map(p => p.split(",").map(Number)) };
  }),
];
