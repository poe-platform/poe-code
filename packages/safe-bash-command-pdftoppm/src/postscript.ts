/** Paint the rendered page using Level 2 RGB PostScript. The short data-source
 * string keeps interpreter memory bounded independently of the page width. */
export function postscriptPageHeader(page: number, width: number, height: number, dpiX: number, dpiY: number, eps: boolean): string {
 const pageSize = `${width * 72 / dpiX} ${height * 72 / dpiY}`;
 return `%%Page: ${page} ${page}\n${eps ? "" : `<< /PageSize [${pageSize}] >> setpagedevice\n`}gsave\n${width * 72 / dpiX} ${height * 72 / dpiY} scale\n${width} ${height} 8 [${width} 0 0 -${height} 0 ${height}]\n{currentfile 3 string readhexstring pop} false 3 colorimage`;
}

export function* postscriptPixels(pixels: Uint8Array): Generator<string> {
 for (let start = 0; start < pixels.length; start += 4096) {
  let hex = '';
  for (let at = start; at < Math.min(start + 4096, pixels.length); at += 4) {
   for (let channel = 0; channel < 3; channel++) hex += pixels[at + channel]!.toString(16).padStart(2, '0');
  }
  yield hex;
 }
}
