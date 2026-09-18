# wkhtmltopdf flag reference

All 122 switches from the pinned source are represented below. **Admitted means parsed settings, not implemented rendering.** No renderer is included. Resource, harness and excluded dispositions reject with `UNSUPPORTED_CAPABILITY`; supplying a renderer does not enable them. TOC parses but conversion rejects. Only help, extended-help and version information actions execute.

Global flags must precede objects. Page flags may precede inputs as defaults or follow their page/cover object; TOC flags belong to TOC objects. Long names require separate operands, never `--key=value`. Short groups also consume separate operands. The adapter accepts `--`; the parser requires `endOfOptions: true` for that deliberate deviation.

| Flag | Short | Scope | Operands | Admission |
| --- | --- | --- | ---: | --- |
| `--help` | `-h` | global | 0 | settings |
| `--version` | `-V` | global | 0 | settings |
| `--license` | — | global | 0 | settings |
| `--extended-help` | `-H` | global | 0 | settings |
| `--manpage` | — | global | 0 | settings |
| `--htmldoc` | — | global | 0 | settings |
| `--readme` | — | global | 0 | settings |
| `--quiet` | `-q` | global | 0 | settings |
| `--log-level` | — | global | 1 | settings |
| `--no-collate` | — | global | 0 | settings |
| `--collate` | — | global | 0 | settings |
| `--copies` | — | global | 1 | settings |
| `--orientation` | `-O` | global | 1 | settings |
| `--page-size` | `-s` | global | 1 | settings |
| `--grayscale` | `-g` | global | 0 | settings |
| `--lowquality` | `-l` | global | 0 | settings |
| `--title` | — | global | 1 | settings |
| `--read-args-from-stdin` | — | global | 0 | settings |
| `--margin-bottom` | `-B` | global | 1 | settings |
| `--margin-left` | `-L` | global | 1 | settings |
| `--margin-right` | `-R` | global | 1 | settings |
| `--margin-top` | `-T` | global | 1 | settings |
| `--dpi` | `-d` | global | 1 | settings |
| `--page-height` | — | global | 1 | settings |
| `--page-width` | — | global | 1 | settings |
| `--cookie-jar` | — | global | 1 | rejected: resource |
| `--image-quality` | — | global | 1 | settings |
| `--image-dpi` | — | global | 1 | settings |
| `--no-pdf-compression` | — | global | 0 | settings |
| `--use-xserver` | — | global | 0 | rejected: excluded |
| `--outline` | — | global | 0 | settings |
| `--no-outline` | — | global | 0 | settings |
| `--outline-depth` | — | global | 1 | settings |
| `--dump-outline` | — | global | 1 | rejected: resource |
| `--dump-default-toc-xsl` | — | global | 0 | settings |
| `--default-header` | — | page | 0 | settings |
| `--viewport-size` | — | page | 1 | settings |
| `--enable-plugins` | — | page | 0 | rejected: excluded |
| `--disable-plugins` | — | page | 0 | settings |
| `--minimum-font-size` | — | page | 1 | settings |
| `--user-style-sheet` | — | page | 1 | rejected: resource |
| `--no-images` | — | page | 0 | settings |
| `--images` | — | page | 0 | settings |
| `--disable-javascript` | `-n` | page | 0 | settings |
| `--enable-javascript` | — | page | 0 | rejected: harness |
| `--encoding` | — | page | 1 | settings |
| `--no-background` | — | page | 0 | settings |
| `--background` | — | page | 0 | settings |
| `--include-in-outline` | — | page | 0 | settings |
| `--exclude-from-outline` | — | page | 0 | settings |
| `--disable-smart-shrinking` | — | page | 0 | settings |
| `--enable-smart-shrinking` | — | page | 0 | settings |
| `--print-media-type` | — | page | 0 | settings |
| `--no-print-media-type` | — | page | 0 | settings |
| `--enable-forms` | — | page | 0 | settings |
| `--disable-forms` | — | page | 0 | settings |
| `--disable-internal-links` | — | page | 0 | settings |
| `--enable-internal-links` | — | page | 0 | settings |
| `--disable-external-links` | — | page | 0 | settings |
| `--enable-external-links` | — | page | 0 | settings |
| `--resolve-relative-links` | — | page | 0 | settings |
| `--keep-relative-links` | — | page | 0 | settings |
| `--enable-toc-back-links` | — | page | 0 | settings |
| `--disable-toc-back-links` | — | page | 0 | settings |
| `--proxy` | `-p` | page | 1 | rejected: resource |
| `--proxy-hostname-lookup` | — | page | 0 | rejected: resource |
| `--bypass-proxy-for` | — | page | 1 | rejected: resource |
| `--username` | — | page | 1 | rejected: resource |
| `--password` | — | page | 1 | rejected: resource |
| `--ssl-key-path` | — | page | 1 | rejected: resource |
| `--ssl-key-password` | — | page | 1 | rejected: resource |
| `--ssl-crt-path` | — | page | 1 | rejected: resource |
| `--load-error-handling` | — | page | 1 | settings |
| `--load-media-error-handling` | — | page | 1 | settings |
| `--custom-header` | — | page | 2 | rejected: resource |
| `--custom-header-propagation` | — | page | 0 | rejected: resource |
| `--no-custom-header-propagation` | — | page | 0 | rejected: resource |
| `--javascript-delay` | — | page | 1 | rejected: harness |
| `--window-status` | — | page | 1 | rejected: harness |
| `--zoom` | — | page | 1 | settings |
| `--cookie` | — | page | 2 | rejected: resource |
| `--post` | — | page | 2 | rejected: resource |
| `--post-file` | — | page | 2 | rejected: resource |
| `--disable-local-file-access` | — | page | 0 | settings |
| `--enable-local-file-access` | — | page | 0 | rejected: resource |
| `--allow` | — | page | 1 | rejected: resource |
| `--cache-dir` | — | page | 1 | rejected: resource |
| `--debug-javascript` | — | page | 0 | rejected: harness |
| `--no-debug-javascript` | — | page | 0 | rejected: harness |
| `--stop-slow-scripts` | — | page | 0 | rejected: harness |
| `--no-stop-slow-scripts` | — | page | 0 | rejected: harness |
| `--run-script` | — | page | 1 | rejected: harness |
| `--checkbox-svg` | — | page | 1 | rejected: resource |
| `--checkbox-checked-svg` | — | page | 1 | rejected: resource |
| `--radiobutton-svg` | — | page | 1 | rejected: resource |
| `--radiobutton-checked-svg` | — | page | 1 | rejected: resource |
| `--page-offset` | — | page | 1 | settings |
| `--footer-center` | — | page | 1 | settings |
| `--footer-font-name` | — | page | 1 | settings |
| `--footer-font-size` | — | page | 1 | settings |
| `--footer-left` | — | page | 1 | settings |
| `--footer-line` | — | page | 0 | settings |
| `--no-footer-line` | — | page | 0 | settings |
| `--footer-right` | — | page | 1 | settings |
| `--footer-spacing` | — | page | 1 | settings |
| `--footer-html` | — | page | 1 | rejected: resource |
| `--header-center` | — | page | 1 | settings |
| `--header-font-name` | — | page | 1 | settings |
| `--header-font-size` | — | page | 1 | settings |
| `--header-left` | — | page | 1 | settings |
| `--header-line` | — | page | 0 | settings |
| `--no-header-line` | — | page | 0 | settings |
| `--header-right` | — | page | 1 | settings |
| `--header-spacing` | — | page | 1 | settings |
| `--header-html` | — | page | 1 | rejected: resource |
| `--replace` | — | page | 2 | settings |
| `--xsl-style-sheet` | — | toc | 1 | rejected: resource |
| `--toc-header-text` | — | toc | 1 | settings |
| `--disable-toc-links` | — | toc | 0 | settings |
| `--disable-dotted-lines` | — | toc | 0 | settings |
| `--toc-text-size-shrink` | — | toc | 1 | settings |
| `--toc-level-indentation` | — | toc | 1 | settings |

Repeated entries retain order and duplicate keys. Integer operands use checked decimal int32; float operands round to binary32. Nonfinite values, nonpositive zoom/copies/DPI/font sizes and negative furniture spacing reject. Length aliases normalize cm/m to mm; all margin units must then match. Native encoding and numeric boundary equivalence remain unqualified.
