/** Released GOffice 0.10.61 enum order; listing is independent of renderer availability. */
export const imageFormats = Object.freeze([
  { id: "svg", description: "SVG (vector graphics)", extension: "svg", graphRenderable: true, mediaType: "image/svg+xml" },
  { id: "png", description: "PNG (raster graphics)", extension: "png", graphRenderable: true, mediaType: "image/png" },
  { id: "jpeg", description: "JPEG (photograph)", extension: "jpg", graphRenderable: true, mediaType: "image/jpeg" },
  { id: "pdf", description: "PDF (portable document format)", extension: "pdf", graphRenderable: true, mediaType: "application/pdf" },
  { id: "ps", description: "PS (postscript)", extension: "ps", graphRenderable: true, mediaType: "application/postscript" },
  { id: "emf", description: "EMF (extended metafile)", extension: "emf", graphRenderable: false, mediaType: "image/x-emf" },
  { id: "wmf", description: "WMF (windows metafile)", extension: "wmf", graphRenderable: false, mediaType: "image/x-wmf" },
  { id: "eps", description: "EPS (encapsulated postscript)", extension: "eps", graphRenderable: true, mediaType: "application/postscript" }
].map(format => Object.freeze(format)));
/** GdkPixbuf 2.42.12 captured loader profile. These IDs are not enum listings
 * and must not participate in enum-only extension inference.
 */
export const profileImageTargets = Object.freeze([
  ...imageFormats,
  ...[
    { id: "bmp", graphRenderable: true, mediaType: "image/bmp" },
    { id: "ico", graphRenderable: true, mediaType: "image/x-icon" },
    { id: "tiff", graphRenderable: true, mediaType: "image/tiff" },
    ...["ani", "gif", "icns", "pnm", "qtif", "tga", "xbm", "xpm"].map(id => ({ id, graphRenderable: false, mediaType: "application/octet-stream" }))
  ].map(target => Object.freeze(target))
]);
/** A recoverable per-object save failure; budget and cancellation errors remain fatal. */
export class ImageExportError extends Error {}
