export interface Length { value: number; unit: "mm" | "in" | "pt" | "px" | "pc" | "didot" | "cicero" }

export function createGlobalSettings() {
  return {
    logLevel: "info", orientation: "Portrait", pageSize: "A4", dpi: 96,
    copies: 1, collate: true, outline: true, outlineDepth: 4,
    imageDPI: 600, imageQuality: 94, useCompression: true,
    colorMode: "color", resolution: "high", documentTitle: "",
    marginTop: { value: -1, unit: "mm" } as Length,
    marginBottom: { value: -1, unit: "mm" } as Length,
    marginLeft: { value: 10, unit: "mm" } as Length,
    marginRight: { value: 10, unit: "mm" } as Length,
    pageHeight: { value: -1, unit: "mm" } as Length,
    pageWidth: { value: -1, unit: "mm" } as Length,
    pageOffset: 0, resolveRelativeLinks: true, viewportSize: "",
    readArgsFromStdin: false, action: "" as string,
  };
}

export function createPageSettings() {
  return {
    header: { fontSize: 12, fontName: "Arial", left: "", right: "", center: "", line: false, htmlUrl: "", spacing: 0 },
    footer: { fontSize: 12, fontName: "Arial", left: "", right: "", center: "", line: false, htmlUrl: "", spacing: 0 },
    toc: { useDottedLines: true, captionText: "Table of Contents", forwardLinks: true, backLinks: false, indentation: "1em", fontScale: Math.fround(0.8) },
    web: { background: true, loadImages: true, enableJavascript: true, enableIntelligentShrinking: true, minimumFontSize: -1, defaultEncoding: "", enablePlugins: false },
    load: { jsdelay: 200, zoomFactor: 1, blockLocalFileAccess: true, stopSlowScripts: true, loadErrorHandling: "abort", mediaLoadErrorHandling: "ignore", printMediaType: false },
    includeInOutline: true, pagesCount: true, produceForms: false,
    useLocalLinks: true, useExternalLinks: true,
    replacements: [] as [string, string][],
  };
}

export type GlobalSettings = ReturnType<typeof createGlobalSettings>;
export type PageSettings = ReturnType<typeof createPageSettings>;

export function clonePageSettings(settings: PageSettings): PageSettings {
  return {
    ...settings, header: { ...settings.header }, footer: { ...settings.footer },
    toc: { ...settings.toc }, web: { ...settings.web }, load: { ...settings.load },
    replacements: settings.replacements.map(([key, value]) => [key, value]),
  };
}
