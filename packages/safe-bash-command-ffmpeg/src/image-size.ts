// FFmpeg's av_parse_video_size aliases (case-sensitive).
const imageSizes: Record<string, readonly [number, number]> = {
  ntsc: [720, 480], pal: [720, 576], qntsc: [352, 240], qpal: [352, 288],
  sntsc: [640, 480], spal: [768, 576], film: [352, 240], "ntsc-film": [352, 240],
  sqcif: [128, 96], qcif: [176, 144], cif: [352, 288], "4cif": [704, 576], "16cif": [1408, 1152],
  qqvga: [160, 120], qvga: [320, 240], vga: [640, 480], svga: [800, 600],
  xga: [1024, 768], uxga: [1600, 1200], qxga: [2048, 1536], sxga: [1280, 1024],
  qsxga: [2560, 2048], hsxga: [5120, 4096], wvga: [852, 480], wxga: [1366, 768],
  wsxga: [1600, 1024], wuxga: [1920, 1200], woxga: [2560, 1600], wqhd: [2560, 1440],
  wqsxga: [3200, 2048], wquxga: [3840, 2400], whsxga: [6400, 4096], whuxga: [7680, 4800],
  cga: [320, 200], ega: [640, 350], hd480: [852, 480], hd720: [1280, 720],
  hd1080: [1920, 1080], quadhd: [2560, 1440], "2k": [2048, 1080], "2kdci": [2048, 1080],
  "2kflat": [1998, 1080], "2kscope": [2048, 858], "4k": [4096, 2160], "4kdci": [4096, 2160],
  "4kflat": [3996, 2160], "4kscope": [4096, 1716], nhd: [640, 360], hqvga: [240, 160],
  wqvga: [400, 240], fwqvga: [432, 240], hvga: [480, 320], qhd: [960, 540],
  uhd2160: [3840, 2160], uhd4320: [7680, 4320]
};

export function parseImageSize(value: string): readonly [number, number] | undefined {
  if (Object.hasOwn(imageSizes, value)) return imageSizes[value];
  let offset = 0;
  const dimension = (): number => {
    while (offset < value.length && " \t\n\r\v\f".includes(value[offset]!)) offset++;
    const start = offset;
    if (value[offset] === "+" || value[offset] === "-") offset++;
    const digits = offset;
    while (offset < value.length && value[offset]! >= "0" && value[offset]! <= "9") offset++;
    return offset === digits ? NaN : Number(value.slice(start, offset));
  };
  const width = dimension();
  // Native image sizes skip one arbitrary separator between decimal integers.
  if (offset < value.length) offset++;
  const height = dimension();
  if (offset !== value.length || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > 2147483647 || height > 2147483647) return undefined;
  return [width, height];
}
