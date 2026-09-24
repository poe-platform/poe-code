# safe-bash-command-tesseract

Pure TypeScript OCR and searchable PDF command (`tesseract`) for `@poe-platform/safe-bash`, powered by `@poe-code/pdf-ast`.

## Features

- **Multi-format Input**: Recognizes text from PNG, PPM/PGM/PBM, BMP, and multi-page PDF documents (including scanned/raster PDFs).
- **Searchable PDF Generation**: Produces searchable PDFs (`pdf` config) embedding page raster images with aligned, selectable text layers via `@poe-code/pdf-ast`.
- **Structured OCR Outputs**: Supports `txt`, `tsv` (12-column Tesseract TSV), `hocr` (XHTML 1.0 with `bbox` and `x_wconf`), `box` (bottom-origin character boxes), and `osd` (Orientation & Script Detection).
- **Sandbox Safe**: Zero native binaries or network dependencies; runs entirely against virtual filesystems (`safe-bash-contracts`) with bounded memory and CPU budgets.
