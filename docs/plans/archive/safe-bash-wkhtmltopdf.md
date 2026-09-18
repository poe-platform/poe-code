---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
readiness: draft
tasks:
  - id: research-wkhtmltopdf
    title: Pin wkhtmltopdf behavior and acceptance matrix
    prompt: >
      Keep this command in packages/safe-bash-command-wkhtmltopdf, with package
      name safe-bash-command-wkhtmltopdf, private: true and no external runtime
      dependencies. Follow docs/plans/safe-bash-command-package-pattern.md.
      Expose its API through @poe-platform/safe-bash/commands/wkhtmltopdf;
      safe-bash only composes and exports it. Bundle private workspace
      implementation and declarations into the safe-bash artifact so installed
      consumers never need an unpublished package. Do not publish the command
      package without explicit instruction. Use TypeScript ESM and byte streams,
      VFS-only I/O, explicit cancellation, invocation cleanup and bounded
      resource accounting. No host executables, implicit network, ambient files,
      native/WASM fallback or dynamic dependency downloads. Keep CLI and SDK
      behavior equivalent. TDD is required for code; unit tests use memfs or
      memory VFS and mocked external capabilities. Preserve unrelated edits.

      Pin wkhtmltopdf page size/orientation/margins, encoding, print media,
      headers/footers, page numbers, TOC, resource/base-URL and multi-input
      behavior. Specify supported HTML/CSS profile with incremental gates toward
      browser-quality documents. JavaScript execution and network are opt-in
      separately, never inferred from HTML input. Inspect current main for
      existing implementation and tests before adding anything. Validate
      reported gaps with failing tests or concrete evidence. Record pinned
      native version/specification, exact flag interactions, fixtures and
      expected stdout/stderr/status. Keep independent compatibility controls
      separate from implementation tests.


      Self-contained researched semantics: Pin
      wkhtmltopdf024b2b2bb459dd904d15b911d04c6df4ff2c9031 archived2022.
      src/pdf/pdfarguments.cc flags, pdfcommandlineparser.cc object scopes,
      shared/commandlineparserbase.cc parseArg, pdf/wkhtmltopdf.cc batch
      tokenizer/main, lib/pdfsettings/loadsettings/websettings defaults,
      multipageloader.cc access/errors/waits, pdfconverter.cc
      margins/pagination/header/footer/copies/output. Source-derived only; no
      native executable control yet. Patched Qt macro changes multiple
      objects/outlines/headers/links/forms/TOC support; pin full binary/Qt patch
      profile before compatibility assertions. Defaults Portrait/A4(dimension
      source verify),96DPI,copies1/collate true,outline true
      depth4,imageDPI600/quality94,compression true; left/right10mm, top/bottom
      auto sentinel-1 then10mm without headers or measured HTML header+spacing.
      Header/footer Arial12/spacing0; TOC dotted lines/title Table of
      Contents/indent1em/fontScale0.8/forwardLinks true/back false. Web
      background/images/JS/smart shrinking true, plugins false. Loader JS
      delay200, zoom1, local-file blocking true, stop slow true, page-load
      abort/media ignore, screen media default. Parser leading global|page
      options create defaults cloned per object, page/cover input and toc
      objects followed by scoped options, last argv output exactly. Cover AFTER
      option parsing clears header/footer text/line/html and outline inclusion;
      not pagesCount automatically. Global-only flags after object fail
      incorrect location1. Long options exact token, not --key=value; short
      grouped options consume separate following operands (no generic attached
      -wN assumption). Pinned parseArg has argv[arg][2]=='0' ASCII zero, not
      NUL: bare -- appears unknown, --0... activates defaultMode; source-derived
      version quirk needs native control or deliberate safe '--' deviation.
      Unknown/missing/invalid/misplaced1 stderr. read-args-from-stdin custom
      state tokenizer: no shell expansion, backslash escapes one char even in
      single quotes, empty quoted tokens dropped, unmatched quotes accepted;
      each line combines original argv, fresh settings, stops first failed
      conversion1. Input/output '-' stdin/stdout, stdout may native tempfile
      spool, product own bounded VFS stage. All four margin units must match
      source, mixed units error (unit conversion extension explicit). Pixels at
      WebKit96 then dpi/96 device factor and zoom/smart-shrink; not CSS px=PDF
      pt. Native blocked local access canonicalizes path and ascends allowed
      ancestors; main input file autoallowed, denied replaced about:blank with
      warning. Product VFS identity-aware capabilities only, no host paths;
      enabled-local cannot escape VFS. URL/cookies/proxy/auth/custom
      headers/post/cert/cache options unsupported without explicit supplied
      bounded resources, no implicit network. Native SSL ignores errors; product
      must never recreate blanket bypass. Native
      scripts/run-script/alerts/window.status/printRequested alter load
      completion; no untrusted execution via JS eval or ambient DOM/browser.
      Declare static first-party renderer profile, reject dynamic execution
      flags or require separately approved safe harness capability, with
      explicit deviation. Loader waits status every50ms indefinitely then
      jsdelay; product explicit work/deadline/cancel bound. Forms and links
      inert output semantics; TOC native XSLT and outline need qualified source
      model, no external entity/URL fetch. Existing Pandoc HTML/PDF conversion
      uses external deps and simplified layout, not WebKit fidelity; do not
      wholesale import. First-party HTML5/CSS cascade/box/font/shaping/paged
      layout/writer engines required; static subset cannot be called full
      browser parity. Archived renderer lacks modern browser CSS; pinned legacy
      behavior distinct from modern standards.


      Independent additional findings: Exact source-derived statuses from
      src/lib/utilities.cc handleError: nonzero errorCode takes precedence over
      success; HTTP404 exits2, HTTP401 exits3, other HTTP errors exit1; network
      error codes stored as1000+QNetworkReply enum exit1 with symbolic network
      diagnostic. success=false/errorCode0 exits1 with unknown-error diagnostic;
      true/0 exits0. read-args-from-stdin batch branch bypasses helper,
      success0/failure1. Native patched-Qt execution still unqualified; do not
      flatten documented single-job statuses to a generic1.



      Pagination and outline source audit at wkhtmltopdf
      024b2b2bb459dd904d15b911d04c6df4ff2c9031: pdfconverter.cc preprocessPage
      records logical pageCount as zero when pagesCount=false, but printDocument
      prints actual QWebPrinter pages. spoolTo advances pageNumber only for
      counted objects. Collated copies repeat the whole document and reset
      logical pageNumber to 1; uncollated copies repeat each physical page
      before advancing. Cover clears headers/footers and includeInOutline, but
      does not automatically disable pagesCount. Outline has another counter:
      addEmptyWebPage adds a one-page placeholder, whereas replaceWebPage uses
      actual printer pageCount even for pagesCount=false. Therefore TOC prefix
      sums/header topage, logical numbering and physical output cannot be
      assumed identical. Preserve this distinction in compatibility controls or
      document an intentional corrected behavior.


      TOC is a fixed-point loop: loadTocs dumps outline XML, applies Qt XSLT
      2.0, loads generated HTML, and tocLoaded repeats if page count or outline
      differs. No source iteration bound was found; first-party implementation
      must enforce iteration/work budgets, cancellation and a convergence
      diagnostic. Supplied XSLT must not gain ambient files, entity resolution
      or network capabilities. Pin supported XSLT profile separately.


      outline.cc replaceWebPage selects h1 through h9 and sorts by rendered
      (page,y,x), not DOM order. Its QMap overwrites headings at identical
      coordinates. Empty text and page=-1 are omitted; LF becomes a space and
      surrounding whitespace is trimmed. A level stack attaches skipped heading
      levels to the preceding lower level. Anchor reuse compares subtree size,
      document, value and display; reused tocAnchor is assigned the previous
      anchor in this source, a suspected defect requiring an independent control
      rather than automatic imitation. Header section/subsection/subsubsection
      caches retain the first heading at each level on a page and carry it
      forward. Built-in header keys overwrite custom replacements of the same
      name. Date/time uses current local clock/system locale; first-party engine
      needs explicit clock and locale inputs.


      findLinks resolves href against frame base URL. Known input-document URLs
      become local destinations, with no-fragment body or fragment lookup in
      order a[name], any[id], any[name]; unmatched fragments in known documents
      are omitted instead of becoming external links. Other URLs are external if
      enabled, either resolved or original according to resolveRelativeLinks.
      Reserved __WKANCHOR_ names/hrefs have special handling. Test percent
      encoding, duplicate inputs, URL fragments containing selector syntax,
      absent targets and link geometry. These are source-only findings, not
      executed patched-Qt evidence; the unpatched branch prints only objects[0].



      Full pinned switch inventory:122 unique declarations,35 global/81 page/6
      TOC, including Unix-conditional use-xserver. Source traversal follows
      PdfCommandLineParser constructor and
      addDocArgs/addGlobalLoadArgs/addWebArgs/addPageLoadArgs with inherited
      mode/qthack state; it is source evidence, not patched-Qt execution.
      global: --help, --version, --license, --extended-help, --manpage,
      --htmldoc, --readme, --quiet, --log-level, --no-collate, --collate,
      --copies, --orientation, --page-size, --grayscale, --lowquality, --title,
      --read-args-from-stdin, --margin-bottom, --margin-left, --margin-right,
      --margin-top, --dpi, --page-height, --page-width, --cookie-jar,
      --image-quality, --image-dpi, --no-pdf-compression, --use-xserver,
      --outline, --no-outline, --outline-depth, --dump-outline,
      --dump-default-toc-xsl. page: --default-header, --viewport-size,
      --enable-plugins, --disable-plugins, --minimum-font-size,
      --user-style-sheet, --no-images, --images, --disable-javascript,
      --enable-javascript, --encoding, --no-background, --background,
      --include-in-outline, --exclude-from-outline, --disable-smart-shrinking,
      --enable-smart-shrinking, --print-media-type, --no-print-media-type,
      --enable-forms, --disable-forms, --disable-internal-links,
      --enable-internal-links, --disable-external-links,
      --enable-external-links, --resolve-relative-links, --keep-relative-links,
      --enable-toc-back-links, --disable-toc-back-links, --proxy,
      --proxy-hostname-lookup, --bypass-proxy-for, --username, --password,
      --ssl-key-path, --ssl-key-password, --ssl-crt-path, --load-error-handling,
      --load-media-error-handling, --custom-header, --custom-header-propagation,
      --no-custom-header-propagation, --javascript-delay, --window-status,
      --zoom, --cookie, --post, --post-file, --disable-local-file-access,
      --enable-local-file-access, --allow, --cache-dir, --debug-javascript,
      --no-debug-javascript, --stop-slow-scripts, --no-stop-slow-scripts,
      --run-script, --checkbox-svg, --checkbox-checked-svg, --radiobutton-svg,
      --radiobutton-checked-svg, --page-offset, --footer-center,
      --footer-font-name, --footer-font-size, --footer-left, --footer-line,
      --no-footer-line, --footer-right, --footer-spacing, --footer-html,
      --header-center, --header-font-name, --header-font-size, --header-left,
      --header-line, --no-header-line, --header-right, --header-spacing,
      --header-html, --replace. toc: --xsl-style-sheet, --toc-header-text,
      --disable-toc-links, --disable-dotted-lines, --toc-text-size-shrink,
      --toc-level-indentation. Retain every switch in the
      implementation/rejection matrix. Zero-argument ConstSetter/Caller,
      one-argument typed setters/list append, two-argument
      custom-header/cookie/post/post-file/replace; repeat map/list handlers
      APPEND entries, not overwrite in a JS object, so duplicate keys/order
      require controls. QStrSetter uses QString::fromLocal8Bit: explicit CLI
      encoding profile must replace ambient host conversion; literal Unicode SDK
      strings remain separate. IntSetter uses QString.toInt, FloatSetter uses
      toFloat and stores binary32; do not silently use arbitrary JS float
      precision for zoom/header spacing/TOC shrink. Unpatched parseArg invokes
      handler BEFORE printing unsupported-switch warning: the warning itself
      does not prove setting ignored, downstream macro branches decide effects.
      Native use-xserver also inherits qthack=true from preceding group;
      preserve source finding rather than correct inventory by intuition.
      Header/footer MapSetter replace entries append; same key substitutions
      require ordered source controls. Defaults/settings clones/cover clear
      semantics remain separate from option admission. Native Qt
      numeric/encoding boundary cases remain open; safe finite/checked
      validation deviations are explicit.
    status:
      implement: done
  - id: engine-wkhtmltopdf
    title: Implement wkhtmltopdf parsing and engine contracts
    prompt: >
      Keep this command in packages/safe-bash-command-wkhtmltopdf, with package
      name safe-bash-command-wkhtmltopdf, private: true and no external runtime
      dependencies. Follow docs/plans/safe-bash-command-package-pattern.md.
      Expose its API through @poe-platform/safe-bash/commands/wkhtmltopdf;
      safe-bash only composes and exports it. Bundle private workspace
      implementation and declarations into the safe-bash artifact so installed
      consumers never need an unpublished package. Do not publish the command
      package without explicit instruction. Use TypeScript ESM and byte streams,
      VFS-only I/O, explicit cancellation, invocation cleanup and bounded
      resource accounting. No host executables, implicit network, ambient files,
      native/WASM fallback or dynamic dependency downloads. Keep CLI and SDK
      behavior equivalent. TDD is required for code; unit tests use memfs or
      memory VFS and mocked external capabilities. Preserve unrelated edits.

      Reuse HTML parsing and PDF rendering primitives. Implement computed CSS
      cascade/inheritance, selectors, lengths/units, block/inline formatting,
      font metrics/shaping, lists, images and tables with row/column spans. Add
      pagination, break rules, widows/orphans, positioned content and page
      furniture; flex/grid require independent gates, not silent degradation.
      Prerequisites: Requires HTML/CSS/layout engines and existing PDF writer; a
      parser or screenshot wrapper does not supply browser-quality pagination.
      Write fast original failing engine tests before implementation. Expose
      typed pure APIs with structured errors and explicit limits; do not
      duplicate shared engines or hide unsupported features.


      Self-contained researched semantics: Pin
      wkhtmltopdf024b2b2bb459dd904d15b911d04c6df4ff2c9031 archived2022.
      src/pdf/pdfarguments.cc flags, pdfcommandlineparser.cc object scopes,
      shared/commandlineparserbase.cc parseArg, pdf/wkhtmltopdf.cc batch
      tokenizer/main, lib/pdfsettings/loadsettings/websettings defaults,
      multipageloader.cc access/errors/waits, pdfconverter.cc
      margins/pagination/header/footer/copies/output. Source-derived only; no
      native executable control yet. Patched Qt macro changes multiple
      objects/outlines/headers/links/forms/TOC support; pin full binary/Qt patch
      profile before compatibility assertions. Defaults Portrait/A4(dimension
      source verify),96DPI,copies1/collate true,outline true
      depth4,imageDPI600/quality94,compression true; left/right10mm, top/bottom
      auto sentinel-1 then10mm without headers or measured HTML header+spacing.
      Header/footer Arial12/spacing0; TOC dotted lines/title Table of
      Contents/indent1em/fontScale0.8/forwardLinks true/back false. Web
      background/images/JS/smart shrinking true, plugins false. Loader JS
      delay200, zoom1, local-file blocking true, stop slow true, page-load
      abort/media ignore, screen media default. Parser leading global|page
      options create defaults cloned per object, page/cover input and toc
      objects followed by scoped options, last argv output exactly. Cover AFTER
      option parsing clears header/footer text/line/html and outline inclusion;
      not pagesCount automatically. Global-only flags after object fail
      incorrect location1. Long options exact token, not --key=value; short
      grouped options consume separate following operands (no generic attached
      -wN assumption). Pinned parseArg has argv[arg][2]=='0' ASCII zero, not
      NUL: bare -- appears unknown, --0... activates defaultMode; source-derived
      version quirk needs native control or deliberate safe '--' deviation.
      Unknown/missing/invalid/misplaced1 stderr. read-args-from-stdin custom
      state tokenizer: no shell expansion, backslash escapes one char even in
      single quotes, empty quoted tokens dropped, unmatched quotes accepted;
      each line combines original argv, fresh settings, stops first failed
      conversion1. Input/output '-' stdin/stdout, stdout may native tempfile
      spool, product own bounded VFS stage. All four margin units must match
      source, mixed units error (unit conversion extension explicit). Pixels at
      WebKit96 then dpi/96 device factor and zoom/smart-shrink; not CSS px=PDF
      pt. Native blocked local access canonicalizes path and ascends allowed
      ancestors; main input file autoallowed, denied replaced about:blank with
      warning. Product VFS identity-aware capabilities only, no host paths;
      enabled-local cannot escape VFS. URL/cookies/proxy/auth/custom
      headers/post/cert/cache options unsupported without explicit supplied
      bounded resources, no implicit network. Native SSL ignores errors; product
      must never recreate blanket bypass. Native
      scripts/run-script/alerts/window.status/printRequested alter load
      completion; no untrusted execution via JS eval or ambient DOM/browser.
      Declare static first-party renderer profile, reject dynamic execution
      flags or require separately approved safe harness capability, with
      explicit deviation. Loader waits status every50ms indefinitely then
      jsdelay; product explicit work/deadline/cancel bound. Forms and links
      inert output semantics; TOC native XSLT and outline need qualified source
      model, no external entity/URL fetch. Existing Pandoc HTML/PDF conversion
      uses external deps and simplified layout, not WebKit fidelity; do not
      wholesale import. First-party HTML5/CSS cascade/box/font/shaping/paged
      layout/writer engines required; static subset cannot be called full
      browser parity. Archived renderer lacks modern browser CSS; pinned legacy
      behavior distinct from modern standards.


      Independent additional findings: Exact source-derived statuses from
      src/lib/utilities.cc handleError: nonzero errorCode takes precedence over
      success; HTTP404 exits2, HTTP401 exits3, other HTTP errors exit1; network
      error codes stored as1000+QNetworkReply enum exit1 with symbolic network
      diagnostic. success=false/errorCode0 exits1 with unknown-error diagnostic;
      true/0 exits0. read-args-from-stdin batch branch bypasses helper,
      success0/failure1. Native patched-Qt execution still unqualified; do not
      flatten documented single-job statuses to a generic1.



      Pagination and outline source audit at wkhtmltopdf
      024b2b2bb459dd904d15b911d04c6df4ff2c9031: pdfconverter.cc preprocessPage
      records logical pageCount as zero when pagesCount=false, but printDocument
      prints actual QWebPrinter pages. spoolTo advances pageNumber only for
      counted objects. Collated copies repeat the whole document and reset
      logical pageNumber to 1; uncollated copies repeat each physical page
      before advancing. Cover clears headers/footers and includeInOutline, but
      does not automatically disable pagesCount. Outline has another counter:
      addEmptyWebPage adds a one-page placeholder, whereas replaceWebPage uses
      actual printer pageCount even for pagesCount=false. Therefore TOC prefix
      sums/header topage, logical numbering and physical output cannot be
      assumed identical. Preserve this distinction in compatibility controls or
      document an intentional corrected behavior.


      TOC is a fixed-point loop: loadTocs dumps outline XML, applies Qt XSLT
      2.0, loads generated HTML, and tocLoaded repeats if page count or outline
      differs. No source iteration bound was found; first-party implementation
      must enforce iteration/work budgets, cancellation and a convergence
      diagnostic. Supplied XSLT must not gain ambient files, entity resolution
      or network capabilities. Pin supported XSLT profile separately.


      outline.cc replaceWebPage selects h1 through h9 and sorts by rendered
      (page,y,x), not DOM order. Its QMap overwrites headings at identical
      coordinates. Empty text and page=-1 are omitted; LF becomes a space and
      surrounding whitespace is trimmed. A level stack attaches skipped heading
      levels to the preceding lower level. Anchor reuse compares subtree size,
      document, value and display; reused tocAnchor is assigned the previous
      anchor in this source, a suspected defect requiring an independent control
      rather than automatic imitation. Header section/subsection/subsubsection
      caches retain the first heading at each level on a page and carry it
      forward. Built-in header keys overwrite custom replacements of the same
      name. Date/time uses current local clock/system locale; first-party engine
      needs explicit clock and locale inputs.


      findLinks resolves href against frame base URL. Known input-document URLs
      become local destinations, with no-fragment body or fragment lookup in
      order a[name], any[id], any[name]; unmatched fragments in known documents
      are omitted instead of becoming external links. Other URLs are external if
      enabled, either resolved or original according to resolveRelativeLinks.
      Reserved __WKANCHOR_ names/hrefs have special handling. Test percent
      encoding, duplicate inputs, URL fragments containing selector syntax,
      absent targets and link geometry. These are source-only findings, not
      executed patched-Qt evidence; the unpatched branch prints only objects[0].



      Full pinned switch inventory:122 unique declarations,35 global/81 page/6
      TOC, including Unix-conditional use-xserver. Source traversal follows
      PdfCommandLineParser constructor and
      addDocArgs/addGlobalLoadArgs/addWebArgs/addPageLoadArgs with inherited
      mode/qthack state; it is source evidence, not patched-Qt execution.
      global: --help, --version, --license, --extended-help, --manpage,
      --htmldoc, --readme, --quiet, --log-level, --no-collate, --collate,
      --copies, --orientation, --page-size, --grayscale, --lowquality, --title,
      --read-args-from-stdin, --margin-bottom, --margin-left, --margin-right,
      --margin-top, --dpi, --page-height, --page-width, --cookie-jar,
      --image-quality, --image-dpi, --no-pdf-compression, --use-xserver,
      --outline, --no-outline, --outline-depth, --dump-outline,
      --dump-default-toc-xsl. page: --default-header, --viewport-size,
      --enable-plugins, --disable-plugins, --minimum-font-size,
      --user-style-sheet, --no-images, --images, --disable-javascript,
      --enable-javascript, --encoding, --no-background, --background,
      --include-in-outline, --exclude-from-outline, --disable-smart-shrinking,
      --enable-smart-shrinking, --print-media-type, --no-print-media-type,
      --enable-forms, --disable-forms, --disable-internal-links,
      --enable-internal-links, --disable-external-links,
      --enable-external-links, --resolve-relative-links, --keep-relative-links,
      --enable-toc-back-links, --disable-toc-back-links, --proxy,
      --proxy-hostname-lookup, --bypass-proxy-for, --username, --password,
      --ssl-key-path, --ssl-key-password, --ssl-crt-path, --load-error-handling,
      --load-media-error-handling, --custom-header, --custom-header-propagation,
      --no-custom-header-propagation, --javascript-delay, --window-status,
      --zoom, --cookie, --post, --post-file, --disable-local-file-access,
      --enable-local-file-access, --allow, --cache-dir, --debug-javascript,
      --no-debug-javascript, --stop-slow-scripts, --no-stop-slow-scripts,
      --run-script, --checkbox-svg, --checkbox-checked-svg, --radiobutton-svg,
      --radiobutton-checked-svg, --page-offset, --footer-center,
      --footer-font-name, --footer-font-size, --footer-left, --footer-line,
      --no-footer-line, --footer-right, --footer-spacing, --footer-html,
      --header-center, --header-font-name, --header-font-size, --header-left,
      --header-line, --no-header-line, --header-right, --header-spacing,
      --header-html, --replace. toc: --xsl-style-sheet, --toc-header-text,
      --disable-toc-links, --disable-dotted-lines, --toc-text-size-shrink,
      --toc-level-indentation. Retain every switch in the
      implementation/rejection matrix. Zero-argument ConstSetter/Caller,
      one-argument typed setters/list append, two-argument
      custom-header/cookie/post/post-file/replace; repeat map/list handlers
      APPEND entries, not overwrite in a JS object, so duplicate keys/order
      require controls. QStrSetter uses QString::fromLocal8Bit: explicit CLI
      encoding profile must replace ambient host conversion; literal Unicode SDK
      strings remain separate. IntSetter uses QString.toInt, FloatSetter uses
      toFloat and stores binary32; do not silently use arbitrary JS float
      precision for zoom/header spacing/TOC shrink. Unpatched parseArg invokes
      handler BEFORE printing unsupported-switch warning: the warning itself
      does not prove setting ignored, downstream macro branches decide effects.
      Native use-xserver also inherits qthack=true from preceding group;
      preserve source finding rather than correct inventory by intuition.
      Header/footer MapSetter replace entries append; same key substitutions
      require ordered source controls. Defaults/settings clones/cover clear
      semantics remain separate from option admission. Native Qt
      numeric/encoding boundary cases remain open; safe finite/checked
      validation deviations are explicit.
    status:
      implement: done
      refactor: done
      test: done
  - id: behavior-wkhtmltopdf
    title: Implement wkhtmltopdf intended behavior
    prompt: >
      Keep this command in packages/safe-bash-command-wkhtmltopdf, with package
      name safe-bash-command-wkhtmltopdf, private: true and no external runtime
      dependencies. Follow docs/plans/safe-bash-command-package-pattern.md.
      Expose its API through @poe-platform/safe-bash/commands/wkhtmltopdf;
      safe-bash only composes and exports it. Bundle private workspace
      implementation and declarations into the safe-bash artifact so installed
      consumers never need an unpublished package. Do not publish the command
      package without explicit instruction. Use TypeScript ESM and byte streams,
      VFS-only I/O, explicit cancellation, invocation cleanup and bounded
      resource accounting. No host executables, implicit network, ambient files,
      native/WASM fallback or dynamic dependency downloads. Keep CLI and SDK
      behavior equivalent. TDD is required for code; unit tests use memfs or
      memory VFS and mocked external capabilities. Preserve unrelated edits.

      Implement VFS resource resolution, supplied fonts, data URLs with limits
      and explicitly authorized network capability if requested. Deny ambient
      fonts/files and document JS by default; script execution requires a
      separately authorized legitimate runtime. Support ordered input documents,
      internal anchors and TOC with stable pagination. Never call
      Chromium/WebKit/wkhtmltopdf or bundle a native renderer. Start with
      failing edge-case tests. Implement each acceptance-matrix cell in reviewed
      increments and keep incomplete cells open. Explicitly account for input,
      decoded, retained and output bytes, parser/algorithm work and recursion
      where relevant.


      Self-contained researched semantics: Pin
      wkhtmltopdf024b2b2bb459dd904d15b911d04c6df4ff2c9031 archived2022.
      src/pdf/pdfarguments.cc flags, pdfcommandlineparser.cc object scopes,
      shared/commandlineparserbase.cc parseArg, pdf/wkhtmltopdf.cc batch
      tokenizer/main, lib/pdfsettings/loadsettings/websettings defaults,
      multipageloader.cc access/errors/waits, pdfconverter.cc
      margins/pagination/header/footer/copies/output. Source-derived only; no
      native executable control yet. Patched Qt macro changes multiple
      objects/outlines/headers/links/forms/TOC support; pin full binary/Qt patch
      profile before compatibility assertions. Defaults Portrait/A4(dimension
      source verify),96DPI,copies1/collate true,outline true
      depth4,imageDPI600/quality94,compression true; left/right10mm, top/bottom
      auto sentinel-1 then10mm without headers or measured HTML header+spacing.
      Header/footer Arial12/spacing0; TOC dotted lines/title Table of
      Contents/indent1em/fontScale0.8/forwardLinks true/back false. Web
      background/images/JS/smart shrinking true, plugins false. Loader JS
      delay200, zoom1, local-file blocking true, stop slow true, page-load
      abort/media ignore, screen media default. Parser leading global|page
      options create defaults cloned per object, page/cover input and toc
      objects followed by scoped options, last argv output exactly. Cover AFTER
      option parsing clears header/footer text/line/html and outline inclusion;
      not pagesCount automatically. Global-only flags after object fail
      incorrect location1. Long options exact token, not --key=value; short
      grouped options consume separate following operands (no generic attached
      -wN assumption). Pinned parseArg has argv[arg][2]=='0' ASCII zero, not
      NUL: bare -- appears unknown, --0... activates defaultMode; source-derived
      version quirk needs native control or deliberate safe '--' deviation.
      Unknown/missing/invalid/misplaced1 stderr. read-args-from-stdin custom
      state tokenizer: no shell expansion, backslash escapes one char even in
      single quotes, empty quoted tokens dropped, unmatched quotes accepted;
      each line combines original argv, fresh settings, stops first failed
      conversion1. Input/output '-' stdin/stdout, stdout may native tempfile
      spool, product own bounded VFS stage. All four margin units must match
      source, mixed units error (unit conversion extension explicit). Pixels at
      WebKit96 then dpi/96 device factor and zoom/smart-shrink; not CSS px=PDF
      pt. Native blocked local access canonicalizes path and ascends allowed
      ancestors; main input file autoallowed, denied replaced about:blank with
      warning. Product VFS identity-aware capabilities only, no host paths;
      enabled-local cannot escape VFS. URL/cookies/proxy/auth/custom
      headers/post/cert/cache options unsupported without explicit supplied
      bounded resources, no implicit network. Native SSL ignores errors; product
      must never recreate blanket bypass. Native
      scripts/run-script/alerts/window.status/printRequested alter load
      completion; no untrusted execution via JS eval or ambient DOM/browser.
      Declare static first-party renderer profile, reject dynamic execution
      flags or require separately approved safe harness capability, with
      explicit deviation. Loader waits status every50ms indefinitely then
      jsdelay; product explicit work/deadline/cancel bound. Forms and links
      inert output semantics; TOC native XSLT and outline need qualified source
      model, no external entity/URL fetch. Existing Pandoc HTML/PDF conversion
      uses external deps and simplified layout, not WebKit fidelity; do not
      wholesale import. First-party HTML5/CSS cascade/box/font/shaping/paged
      layout/writer engines required; static subset cannot be called full
      browser parity. Archived renderer lacks modern browser CSS; pinned legacy
      behavior distinct from modern standards.


      Independent additional findings: Exact source-derived statuses from
      src/lib/utilities.cc handleError: nonzero errorCode takes precedence over
      success; HTTP404 exits2, HTTP401 exits3, other HTTP errors exit1; network
      error codes stored as1000+QNetworkReply enum exit1 with symbolic network
      diagnostic. success=false/errorCode0 exits1 with unknown-error diagnostic;
      true/0 exits0. read-args-from-stdin batch branch bypasses helper,
      success0/failure1. Native patched-Qt execution still unqualified; do not
      flatten documented single-job statuses to a generic1.



      Pagination and outline source audit at wkhtmltopdf
      024b2b2bb459dd904d15b911d04c6df4ff2c9031: pdfconverter.cc preprocessPage
      records logical pageCount as zero when pagesCount=false, but printDocument
      prints actual QWebPrinter pages. spoolTo advances pageNumber only for
      counted objects. Collated copies repeat the whole document and reset
      logical pageNumber to 1; uncollated copies repeat each physical page
      before advancing. Cover clears headers/footers and includeInOutline, but
      does not automatically disable pagesCount. Outline has another counter:
      addEmptyWebPage adds a one-page placeholder, whereas replaceWebPage uses
      actual printer pageCount even for pagesCount=false. Therefore TOC prefix
      sums/header topage, logical numbering and physical output cannot be
      assumed identical. Preserve this distinction in compatibility controls or
      document an intentional corrected behavior.


      TOC is a fixed-point loop: loadTocs dumps outline XML, applies Qt XSLT
      2.0, loads generated HTML, and tocLoaded repeats if page count or outline
      differs. No source iteration bound was found; first-party implementation
      must enforce iteration/work budgets, cancellation and a convergence
      diagnostic. Supplied XSLT must not gain ambient files, entity resolution
      or network capabilities. Pin supported XSLT profile separately.


      outline.cc replaceWebPage selects h1 through h9 and sorts by rendered
      (page,y,x), not DOM order. Its QMap overwrites headings at identical
      coordinates. Empty text and page=-1 are omitted; LF becomes a space and
      surrounding whitespace is trimmed. A level stack attaches skipped heading
      levels to the preceding lower level. Anchor reuse compares subtree size,
      document, value and display; reused tocAnchor is assigned the previous
      anchor in this source, a suspected defect requiring an independent control
      rather than automatic imitation. Header section/subsection/subsubsection
      caches retain the first heading at each level on a page and carry it
      forward. Built-in header keys overwrite custom replacements of the same
      name. Date/time uses current local clock/system locale; first-party engine
      needs explicit clock and locale inputs.


      findLinks resolves href against frame base URL. Known input-document URLs
      become local destinations, with no-fragment body or fragment lookup in
      order a[name], any[id], any[name]; unmatched fragments in known documents
      are omitted instead of becoming external links. Other URLs are external if
      enabled, either resolved or original according to resolveRelativeLinks.
      Reserved __WKANCHOR_ names/hrefs have special handling. Test percent
      encoding, duplicate inputs, URL fragments containing selector syntax,
      absent targets and link geometry. These are source-only findings, not
      executed patched-Qt evidence; the unpatched branch prints only objects[0].



      Full pinned switch inventory:122 unique declarations,35 global/81 page/6
      TOC, including Unix-conditional use-xserver. Source traversal follows
      PdfCommandLineParser constructor and
      addDocArgs/addGlobalLoadArgs/addWebArgs/addPageLoadArgs with inherited
      mode/qthack state; it is source evidence, not patched-Qt execution.
      global: --help, --version, --license, --extended-help, --manpage,
      --htmldoc, --readme, --quiet, --log-level, --no-collate, --collate,
      --copies, --orientation, --page-size, --grayscale, --lowquality, --title,
      --read-args-from-stdin, --margin-bottom, --margin-left, --margin-right,
      --margin-top, --dpi, --page-height, --page-width, --cookie-jar,
      --image-quality, --image-dpi, --no-pdf-compression, --use-xserver,
      --outline, --no-outline, --outline-depth, --dump-outline,
      --dump-default-toc-xsl. page: --default-header, --viewport-size,
      --enable-plugins, --disable-plugins, --minimum-font-size,
      --user-style-sheet, --no-images, --images, --disable-javascript,
      --enable-javascript, --encoding, --no-background, --background,
      --include-in-outline, --exclude-from-outline, --disable-smart-shrinking,
      --enable-smart-shrinking, --print-media-type, --no-print-media-type,
      --enable-forms, --disable-forms, --disable-internal-links,
      --enable-internal-links, --disable-external-links,
      --enable-external-links, --resolve-relative-links, --keep-relative-links,
      --enable-toc-back-links, --disable-toc-back-links, --proxy,
      --proxy-hostname-lookup, --bypass-proxy-for, --username, --password,
      --ssl-key-path, --ssl-key-password, --ssl-crt-path, --load-error-handling,
      --load-media-error-handling, --custom-header, --custom-header-propagation,
      --no-custom-header-propagation, --javascript-delay, --window-status,
      --zoom, --cookie, --post, --post-file, --disable-local-file-access,
      --enable-local-file-access, --allow, --cache-dir, --debug-javascript,
      --no-debug-javascript, --stop-slow-scripts, --no-stop-slow-scripts,
      --run-script, --checkbox-svg, --checkbox-checked-svg, --radiobutton-svg,
      --radiobutton-checked-svg, --page-offset, --footer-center,
      --footer-font-name, --footer-font-size, --footer-left, --footer-line,
      --no-footer-line, --footer-right, --footer-spacing, --footer-html,
      --header-center, --header-font-name, --header-font-size, --header-left,
      --header-line, --no-header-line, --header-right, --header-spacing,
      --header-html, --replace. toc: --xsl-style-sheet, --toc-header-text,
      --disable-toc-links, --disable-dotted-lines, --toc-text-size-shrink,
      --toc-level-indentation. Retain every switch in the
      implementation/rejection matrix. Zero-argument ConstSetter/Caller,
      one-argument typed setters/list append, two-argument
      custom-header/cookie/post/post-file/replace; repeat map/list handlers
      APPEND entries, not overwrite in a JS object, so duplicate keys/order
      require controls. QStrSetter uses QString::fromLocal8Bit: explicit CLI
      encoding profile must replace ambient host conversion; literal Unicode SDK
      strings remain separate. IntSetter uses QString.toInt, FloatSetter uses
      toFloat and stores binary32; do not silently use arbitrary JS float
      precision for zoom/header spacing/TOC shrink. Unpatched parseArg invokes
      handler BEFORE printing unsupported-switch warning: the warning itself
      does not prove setting ignored, downstream macro branches decide effects.
      Native use-xserver also inherits qthack=true from preceding group;
      preserve source finding rather than correct inventory by intuition.
      Header/footer MapSetter replace entries append; same key substitutions
      require ordered source controls. Defaults/settings clones/cover clear
      semantics remain separate from option admission. Native Qt
      numeric/encoding boundary cases remain open; safe finite/checked
      validation deviations are explicit.
    status:
      implement: done
      refactor: done
      test: done
  - id: command-wkhtmltopdf
    title: Wire wkhtmltopdf CLI SDK and safe-bash export
    prompt: >
      Keep this command in packages/safe-bash-command-wkhtmltopdf, with package
      name safe-bash-command-wkhtmltopdf, private: true and no external runtime
      dependencies. Follow docs/plans/safe-bash-command-package-pattern.md.
      Expose its API through @poe-platform/safe-bash/commands/wkhtmltopdf;
      safe-bash only composes and exports it. Bundle private workspace
      implementation and declarations into the safe-bash artifact so installed
      consumers never need an unpublished package. Do not publish the command
      package without explicit instruction. Use TypeScript ESM and byte streams,
      VFS-only I/O, explicit cancellation, invocation cleanup and bounded
      resource accounting. No host executables, implicit network, ambient files,
      native/WASM fallback or dynamic dependency downloads. Keep CLI and SDK
      behavior equivalent. TDD is required for code; unit tests use memfs or
      memory VFS and mocked external capabilities. Preserve unrelated edits.

      Create actual CommandDefinition and optional plugin factory in the command
      package; argument parsing accepts --, grouped/attached options where
      upstream permits, stdin and literal VFS paths. Expose equivalent SDK
      options and typed results. Follow native exit-status semantics and
      deterministic stderr; unknown flags fail explicitly. Await ByteSink
      writes, forward signal to every I/O, register cleanup before owned
      resource acquisition and preserve producer byte ownership. Route literal
      child invocations through context.invoke if needed. Integrate proposed
      @poe-platform/safe-bash/commands/wkhtmltopdf with the qualified
      package-pattern build path and no default registration change.


      Self-contained researched semantics: Pin
      wkhtmltopdf024b2b2bb459dd904d15b911d04c6df4ff2c9031 archived2022.
      src/pdf/pdfarguments.cc flags, pdfcommandlineparser.cc object scopes,
      shared/commandlineparserbase.cc parseArg, pdf/wkhtmltopdf.cc batch
      tokenizer/main, lib/pdfsettings/loadsettings/websettings defaults,
      multipageloader.cc access/errors/waits, pdfconverter.cc
      margins/pagination/header/footer/copies/output. Source-derived only; no
      native executable control yet. Patched Qt macro changes multiple
      objects/outlines/headers/links/forms/TOC support; pin full binary/Qt patch
      profile before compatibility assertions. Defaults Portrait/A4(dimension
      source verify),96DPI,copies1/collate true,outline true
      depth4,imageDPI600/quality94,compression true; left/right10mm, top/bottom
      auto sentinel-1 then10mm without headers or measured HTML header+spacing.
      Header/footer Arial12/spacing0; TOC dotted lines/title Table of
      Contents/indent1em/fontScale0.8/forwardLinks true/back false. Web
      background/images/JS/smart shrinking true, plugins false. Loader JS
      delay200, zoom1, local-file blocking true, stop slow true, page-load
      abort/media ignore, screen media default. Parser leading global|page
      options create defaults cloned per object, page/cover input and toc
      objects followed by scoped options, last argv output exactly. Cover AFTER
      option parsing clears header/footer text/line/html and outline inclusion;
      not pagesCount automatically. Global-only flags after object fail
      incorrect location1. Long options exact token, not --key=value; short
      grouped options consume separate following operands (no generic attached
      -wN assumption). Pinned parseArg has argv[arg][2]=='0' ASCII zero, not
      NUL: bare -- appears unknown, --0... activates defaultMode; source-derived
      version quirk needs native control or deliberate safe '--' deviation.
      Unknown/missing/invalid/misplaced1 stderr. read-args-from-stdin custom
      state tokenizer: no shell expansion, backslash escapes one char even in
      single quotes, empty quoted tokens dropped, unmatched quotes accepted;
      each line combines original argv, fresh settings, stops first failed
      conversion1. Input/output '-' stdin/stdout, stdout may native tempfile
      spool, product own bounded VFS stage. All four margin units must match
      source, mixed units error (unit conversion extension explicit). Pixels at
      WebKit96 then dpi/96 device factor and zoom/smart-shrink; not CSS px=PDF
      pt. Native blocked local access canonicalizes path and ascends allowed
      ancestors; main input file autoallowed, denied replaced about:blank with
      warning. Product VFS identity-aware capabilities only, no host paths;
      enabled-local cannot escape VFS. URL/cookies/proxy/auth/custom
      headers/post/cert/cache options unsupported without explicit supplied
      bounded resources, no implicit network. Native SSL ignores errors; product
      must never recreate blanket bypass. Native
      scripts/run-script/alerts/window.status/printRequested alter load
      completion; no untrusted execution via JS eval or ambient DOM/browser.
      Declare static first-party renderer profile, reject dynamic execution
      flags or require separately approved safe harness capability, with
      explicit deviation. Loader waits status every50ms indefinitely then
      jsdelay; product explicit work/deadline/cancel bound. Forms and links
      inert output semantics; TOC native XSLT and outline need qualified source
      model, no external entity/URL fetch. Existing Pandoc HTML/PDF conversion
      uses external deps and simplified layout, not WebKit fidelity; do not
      wholesale import. First-party HTML5/CSS cascade/box/font/shaping/paged
      layout/writer engines required; static subset cannot be called full
      browser parity. Archived renderer lacks modern browser CSS; pinned legacy
      behavior distinct from modern standards.


      Independent additional findings: Exact source-derived statuses from
      src/lib/utilities.cc handleError: nonzero errorCode takes precedence over
      success; HTTP404 exits2, HTTP401 exits3, other HTTP errors exit1; network
      error codes stored as1000+QNetworkReply enum exit1 with symbolic network
      diagnostic. success=false/errorCode0 exits1 with unknown-error diagnostic;
      true/0 exits0. read-args-from-stdin batch branch bypasses helper,
      success0/failure1. Native patched-Qt execution still unqualified; do not
      flatten documented single-job statuses to a generic1.



      Pagination and outline source audit at wkhtmltopdf
      024b2b2bb459dd904d15b911d04c6df4ff2c9031: pdfconverter.cc preprocessPage
      records logical pageCount as zero when pagesCount=false, but printDocument
      prints actual QWebPrinter pages. spoolTo advances pageNumber only for
      counted objects. Collated copies repeat the whole document and reset
      logical pageNumber to 1; uncollated copies repeat each physical page
      before advancing. Cover clears headers/footers and includeInOutline, but
      does not automatically disable pagesCount. Outline has another counter:
      addEmptyWebPage adds a one-page placeholder, whereas replaceWebPage uses
      actual printer pageCount even for pagesCount=false. Therefore TOC prefix
      sums/header topage, logical numbering and physical output cannot be
      assumed identical. Preserve this distinction in compatibility controls or
      document an intentional corrected behavior.


      TOC is a fixed-point loop: loadTocs dumps outline XML, applies Qt XSLT
      2.0, loads generated HTML, and tocLoaded repeats if page count or outline
      differs. No source iteration bound was found; first-party implementation
      must enforce iteration/work budgets, cancellation and a convergence
      diagnostic. Supplied XSLT must not gain ambient files, entity resolution
      or network capabilities. Pin supported XSLT profile separately.


      outline.cc replaceWebPage selects h1 through h9 and sorts by rendered
      (page,y,x), not DOM order. Its QMap overwrites headings at identical
      coordinates. Empty text and page=-1 are omitted; LF becomes a space and
      surrounding whitespace is trimmed. A level stack attaches skipped heading
      levels to the preceding lower level. Anchor reuse compares subtree size,
      document, value and display; reused tocAnchor is assigned the previous
      anchor in this source, a suspected defect requiring an independent control
      rather than automatic imitation. Header section/subsection/subsubsection
      caches retain the first heading at each level on a page and carry it
      forward. Built-in header keys overwrite custom replacements of the same
      name. Date/time uses current local clock/system locale; first-party engine
      needs explicit clock and locale inputs.


      findLinks resolves href against frame base URL. Known input-document URLs
      become local destinations, with no-fragment body or fragment lookup in
      order a[name], any[id], any[name]; unmatched fragments in known documents
      are omitted instead of becoming external links. Other URLs are external if
      enabled, either resolved or original according to resolveRelativeLinks.
      Reserved __WKANCHOR_ names/hrefs have special handling. Test percent
      encoding, duplicate inputs, URL fragments containing selector syntax,
      absent targets and link geometry. These are source-only findings, not
      executed patched-Qt evidence; the unpatched branch prints only objects[0].



      Full pinned switch inventory:122 unique declarations,35 global/81 page/6
      TOC, including Unix-conditional use-xserver. Source traversal follows
      PdfCommandLineParser constructor and
      addDocArgs/addGlobalLoadArgs/addWebArgs/addPageLoadArgs with inherited
      mode/qthack state; it is source evidence, not patched-Qt execution.
      global: --help, --version, --license, --extended-help, --manpage,
      --htmldoc, --readme, --quiet, --log-level, --no-collate, --collate,
      --copies, --orientation, --page-size, --grayscale, --lowquality, --title,
      --read-args-from-stdin, --margin-bottom, --margin-left, --margin-right,
      --margin-top, --dpi, --page-height, --page-width, --cookie-jar,
      --image-quality, --image-dpi, --no-pdf-compression, --use-xserver,
      --outline, --no-outline, --outline-depth, --dump-outline,
      --dump-default-toc-xsl. page: --default-header, --viewport-size,
      --enable-plugins, --disable-plugins, --minimum-font-size,
      --user-style-sheet, --no-images, --images, --disable-javascript,
      --enable-javascript, --encoding, --no-background, --background,
      --include-in-outline, --exclude-from-outline, --disable-smart-shrinking,
      --enable-smart-shrinking, --print-media-type, --no-print-media-type,
      --enable-forms, --disable-forms, --disable-internal-links,
      --enable-internal-links, --disable-external-links,
      --enable-external-links, --resolve-relative-links, --keep-relative-links,
      --enable-toc-back-links, --disable-toc-back-links, --proxy,
      --proxy-hostname-lookup, --bypass-proxy-for, --username, --password,
      --ssl-key-path, --ssl-key-password, --ssl-crt-path, --load-error-handling,
      --load-media-error-handling, --custom-header, --custom-header-propagation,
      --no-custom-header-propagation, --javascript-delay, --window-status,
      --zoom, --cookie, --post, --post-file, --disable-local-file-access,
      --enable-local-file-access, --allow, --cache-dir, --debug-javascript,
      --no-debug-javascript, --stop-slow-scripts, --no-stop-slow-scripts,
      --run-script, --checkbox-svg, --checkbox-checked-svg, --radiobutton-svg,
      --radiobutton-checked-svg, --page-offset, --footer-center,
      --footer-font-name, --footer-font-size, --footer-left, --footer-line,
      --no-footer-line, --footer-right, --footer-spacing, --footer-html,
      --header-center, --header-font-name, --header-font-size, --header-left,
      --header-line, --no-header-line, --header-right, --header-spacing,
      --header-html, --replace. toc: --xsl-style-sheet, --toc-header-text,
      --disable-toc-links, --disable-dotted-lines, --toc-text-size-shrink,
      --toc-level-indentation. Retain every switch in the
      implementation/rejection matrix. Zero-argument ConstSetter/Caller,
      one-argument typed setters/list append, two-argument
      custom-header/cookie/post/post-file/replace; repeat map/list handlers
      APPEND entries, not overwrite in a JS object, so duplicate keys/order
      require controls. QStrSetter uses QString::fromLocal8Bit: explicit CLI
      encoding profile must replace ambient host conversion; literal Unicode SDK
      strings remain separate. IntSetter uses QString.toInt, FloatSetter uses
      toFloat and stores binary32; do not silently use arbitrary JS float
      precision for zoom/header spacing/TOC shrink. Unpatched parseArg invokes
      handler BEFORE printing unsupported-switch warning: the warning itself
      does not prove setting ignored, downstream macro branches decide effects.
      Native use-xserver also inherits qthack=true from preceding group;
      preserve source finding rather than correct inventory by intuition.
      Header/footer MapSetter replace entries append; same key substitutions
      require ordered source controls. Defaults/settings clones/cover clear
      semantics remain separate from option admission. Native Qt
      numeric/encoding boundary cases remain open; safe finite/checked
      validation deviations are explicit.
    status:
      implement: done
      refactor: done
      test: done
  - id: safety-wkhtmltopdf
    title: Verify wkhtmltopdf VFS resource and failure boundaries
    prompt: >
      Keep this command in packages/safe-bash-command-wkhtmltopdf, with package
      name safe-bash-command-wkhtmltopdf, private: true and no external runtime
      dependencies. Follow docs/plans/safe-bash-command-package-pattern.md.
      Expose its API through @poe-platform/safe-bash/commands/wkhtmltopdf;
      safe-bash only composes and exports it. Bundle private workspace
      implementation and declarations into the safe-bash artifact so installed
      consumers never need an unpublished package. Do not publish the command
      package without explicit instruction. Use TypeScript ESM and byte streams,
      VFS-only I/O, explicit cancellation, invocation cleanup and bounded
      resource accounting. No host executables, implicit network, ambient files,
      native/WASM fallback or dynamic dependency downloads. Keep CLI and SDK
      behavior equivalent. TDD is required for code; unit tests use memfs or
      memory VFS and mocked external capabilities. Preserve unrelated edits.

      Test actual Shell pipelines, redirects and .sh VFS invocation, chunked
      input, cancellation during parse/output, clean disposal, quota failures
      and hostile inputs. Use memory VFS/memfs only in unit tests. For writes,
      resolve source/destination identity, symlink aliases, same-file hazards
      and conditional/exclusive publication; no read-then-recursive-delete or
      unbounded temp storage. Distinguish partial output from atomic guarantees.
      Test denied host/network capabilities and verify no ambient credentials or
      executable fallback.


      Self-contained researched semantics: Pin
      wkhtmltopdf024b2b2bb459dd904d15b911d04c6df4ff2c9031 archived2022.
      src/pdf/pdfarguments.cc flags, pdfcommandlineparser.cc object scopes,
      shared/commandlineparserbase.cc parseArg, pdf/wkhtmltopdf.cc batch
      tokenizer/main, lib/pdfsettings/loadsettings/websettings defaults,
      multipageloader.cc access/errors/waits, pdfconverter.cc
      margins/pagination/header/footer/copies/output. Source-derived only; no
      native executable control yet. Patched Qt macro changes multiple
      objects/outlines/headers/links/forms/TOC support; pin full binary/Qt patch
      profile before compatibility assertions. Defaults Portrait/A4(dimension
      source verify),96DPI,copies1/collate true,outline true
      depth4,imageDPI600/quality94,compression true; left/right10mm, top/bottom
      auto sentinel-1 then10mm without headers or measured HTML header+spacing.
      Header/footer Arial12/spacing0; TOC dotted lines/title Table of
      Contents/indent1em/fontScale0.8/forwardLinks true/back false. Web
      background/images/JS/smart shrinking true, plugins false. Loader JS
      delay200, zoom1, local-file blocking true, stop slow true, page-load
      abort/media ignore, screen media default. Parser leading global|page
      options create defaults cloned per object, page/cover input and toc
      objects followed by scoped options, last argv output exactly. Cover AFTER
      option parsing clears header/footer text/line/html and outline inclusion;
      not pagesCount automatically. Global-only flags after object fail
      incorrect location1. Long options exact token, not --key=value; short
      grouped options consume separate following operands (no generic attached
      -wN assumption). Pinned parseArg has argv[arg][2]=='0' ASCII zero, not
      NUL: bare -- appears unknown, --0... activates defaultMode; source-derived
      version quirk needs native control or deliberate safe '--' deviation.
      Unknown/missing/invalid/misplaced1 stderr. read-args-from-stdin custom
      state tokenizer: no shell expansion, backslash escapes one char even in
      single quotes, empty quoted tokens dropped, unmatched quotes accepted;
      each line combines original argv, fresh settings, stops first failed
      conversion1. Input/output '-' stdin/stdout, stdout may native tempfile
      spool, product own bounded VFS stage. All four margin units must match
      source, mixed units error (unit conversion extension explicit). Pixels at
      WebKit96 then dpi/96 device factor and zoom/smart-shrink; not CSS px=PDF
      pt. Native blocked local access canonicalizes path and ascends allowed
      ancestors; main input file autoallowed, denied replaced about:blank with
      warning. Product VFS identity-aware capabilities only, no host paths;
      enabled-local cannot escape VFS. URL/cookies/proxy/auth/custom
      headers/post/cert/cache options unsupported without explicit supplied
      bounded resources, no implicit network. Native SSL ignores errors; product
      must never recreate blanket bypass. Native
      scripts/run-script/alerts/window.status/printRequested alter load
      completion; no untrusted execution via JS eval or ambient DOM/browser.
      Declare static first-party renderer profile, reject dynamic execution
      flags or require separately approved safe harness capability, with
      explicit deviation. Loader waits status every50ms indefinitely then
      jsdelay; product explicit work/deadline/cancel bound. Forms and links
      inert output semantics; TOC native XSLT and outline need qualified source
      model, no external entity/URL fetch. Existing Pandoc HTML/PDF conversion
      uses external deps and simplified layout, not WebKit fidelity; do not
      wholesale import. First-party HTML5/CSS cascade/box/font/shaping/paged
      layout/writer engines required; static subset cannot be called full
      browser parity. Archived renderer lacks modern browser CSS; pinned legacy
      behavior distinct from modern standards.


      Independent additional findings: Exact source-derived statuses from
      src/lib/utilities.cc handleError: nonzero errorCode takes precedence over
      success; HTTP404 exits2, HTTP401 exits3, other HTTP errors exit1; network
      error codes stored as1000+QNetworkReply enum exit1 with symbolic network
      diagnostic. success=false/errorCode0 exits1 with unknown-error diagnostic;
      true/0 exits0. read-args-from-stdin batch branch bypasses helper,
      success0/failure1. Native patched-Qt execution still unqualified; do not
      flatten documented single-job statuses to a generic1.



      Pagination and outline source audit at wkhtmltopdf
      024b2b2bb459dd904d15b911d04c6df4ff2c9031: pdfconverter.cc preprocessPage
      records logical pageCount as zero when pagesCount=false, but printDocument
      prints actual QWebPrinter pages. spoolTo advances pageNumber only for
      counted objects. Collated copies repeat the whole document and reset
      logical pageNumber to 1; uncollated copies repeat each physical page
      before advancing. Cover clears headers/footers and includeInOutline, but
      does not automatically disable pagesCount. Outline has another counter:
      addEmptyWebPage adds a one-page placeholder, whereas replaceWebPage uses
      actual printer pageCount even for pagesCount=false. Therefore TOC prefix
      sums/header topage, logical numbering and physical output cannot be
      assumed identical. Preserve this distinction in compatibility controls or
      document an intentional corrected behavior.


      TOC is a fixed-point loop: loadTocs dumps outline XML, applies Qt XSLT
      2.0, loads generated HTML, and tocLoaded repeats if page count or outline
      differs. No source iteration bound was found; first-party implementation
      must enforce iteration/work budgets, cancellation and a convergence
      diagnostic. Supplied XSLT must not gain ambient files, entity resolution
      or network capabilities. Pin supported XSLT profile separately.


      outline.cc replaceWebPage selects h1 through h9 and sorts by rendered
      (page,y,x), not DOM order. Its QMap overwrites headings at identical
      coordinates. Empty text and page=-1 are omitted; LF becomes a space and
      surrounding whitespace is trimmed. A level stack attaches skipped heading
      levels to the preceding lower level. Anchor reuse compares subtree size,
      document, value and display; reused tocAnchor is assigned the previous
      anchor in this source, a suspected defect requiring an independent control
      rather than automatic imitation. Header section/subsection/subsubsection
      caches retain the first heading at each level on a page and carry it
      forward. Built-in header keys overwrite custom replacements of the same
      name. Date/time uses current local clock/system locale; first-party engine
      needs explicit clock and locale inputs.


      findLinks resolves href against frame base URL. Known input-document URLs
      become local destinations, with no-fragment body or fragment lookup in
      order a[name], any[id], any[name]; unmatched fragments in known documents
      are omitted instead of becoming external links. Other URLs are external if
      enabled, either resolved or original according to resolveRelativeLinks.
      Reserved __WKANCHOR_ names/hrefs have special handling. Test percent
      encoding, duplicate inputs, URL fragments containing selector syntax,
      absent targets and link geometry. These are source-only findings, not
      executed patched-Qt evidence; the unpatched branch prints only objects[0].



      Full pinned switch inventory:122 unique declarations,35 global/81 page/6
      TOC, including Unix-conditional use-xserver. Source traversal follows
      PdfCommandLineParser constructor and
      addDocArgs/addGlobalLoadArgs/addWebArgs/addPageLoadArgs with inherited
      mode/qthack state; it is source evidence, not patched-Qt execution.
      global: --help, --version, --license, --extended-help, --manpage,
      --htmldoc, --readme, --quiet, --log-level, --no-collate, --collate,
      --copies, --orientation, --page-size, --grayscale, --lowquality, --title,
      --read-args-from-stdin, --margin-bottom, --margin-left, --margin-right,
      --margin-top, --dpi, --page-height, --page-width, --cookie-jar,
      --image-quality, --image-dpi, --no-pdf-compression, --use-xserver,
      --outline, --no-outline, --outline-depth, --dump-outline,
      --dump-default-toc-xsl. page: --default-header, --viewport-size,
      --enable-plugins, --disable-plugins, --minimum-font-size,
      --user-style-sheet, --no-images, --images, --disable-javascript,
      --enable-javascript, --encoding, --no-background, --background,
      --include-in-outline, --exclude-from-outline, --disable-smart-shrinking,
      --enable-smart-shrinking, --print-media-type, --no-print-media-type,
      --enable-forms, --disable-forms, --disable-internal-links,
      --enable-internal-links, --disable-external-links,
      --enable-external-links, --resolve-relative-links, --keep-relative-links,
      --enable-toc-back-links, --disable-toc-back-links, --proxy,
      --proxy-hostname-lookup, --bypass-proxy-for, --username, --password,
      --ssl-key-path, --ssl-key-password, --ssl-crt-path, --load-error-handling,
      --load-media-error-handling, --custom-header, --custom-header-propagation,
      --no-custom-header-propagation, --javascript-delay, --window-status,
      --zoom, --cookie, --post, --post-file, --disable-local-file-access,
      --enable-local-file-access, --allow, --cache-dir, --debug-javascript,
      --no-debug-javascript, --stop-slow-scripts, --no-stop-slow-scripts,
      --run-script, --checkbox-svg, --checkbox-checked-svg, --radiobutton-svg,
      --radiobutton-checked-svg, --page-offset, --footer-center,
      --footer-font-name, --footer-font-size, --footer-left, --footer-line,
      --no-footer-line, --footer-right, --footer-spacing, --footer-html,
      --header-center, --header-font-name, --header-font-size, --header-left,
      --header-line, --no-header-line, --header-right, --header-spacing,
      --header-html, --replace. toc: --xsl-style-sheet, --toc-header-text,
      --disable-toc-links, --disable-dotted-lines, --toc-text-size-shrink,
      --toc-level-indentation. Retain every switch in the
      implementation/rejection matrix. Zero-argument ConstSetter/Caller,
      one-argument typed setters/list append, two-argument
      custom-header/cookie/post/post-file/replace; repeat map/list handlers
      APPEND entries, not overwrite in a JS object, so duplicate keys/order
      require controls. QStrSetter uses QString::fromLocal8Bit: explicit CLI
      encoding profile must replace ambient host conversion; literal Unicode SDK
      strings remain separate. IntSetter uses QString.toInt, FloatSetter uses
      toFloat and stores binary32; do not silently use arbitrary JS float
      precision for zoom/header spacing/TOC shrink. Unpatched parseArg invokes
      handler BEFORE printing unsupported-switch warning: the warning itself
      does not prove setting ignored, downstream macro branches decide effects.
      Native use-xserver also inherits qthack=true from preceding group;
      preserve source finding rather than correct inventory by intuition.
      Header/footer MapSetter replace entries append; same key substitutions
      require ordered source controls. Defaults/settings clones/cover clear
      semantics remain separate from option admission. Native Qt
      numeric/encoding boundary cases remain open; safe finite/checked
      validation deviations are explicit.
    status:
      test: done
  - id: compatibility-wkhtmltopdf
    title: Qualify wkhtmltopdf against independent controls
    prompt: >
      Keep this command in packages/safe-bash-command-wkhtmltopdf, with package
      name safe-bash-command-wkhtmltopdf, private: true and no external runtime
      dependencies. Follow docs/plans/safe-bash-command-package-pattern.md.
      Expose its API through @poe-platform/safe-bash/commands/wkhtmltopdf;
      safe-bash only composes and exports it. Bundle private workspace
      implementation and declarations into the safe-bash artifact so installed
      consumers never need an unpublished package. Do not publish the command
      package without explicit instruction. Use TypeScript ESM and byte streams,
      VFS-only I/O, explicit cancellation, invocation cleanup and bounded
      resource accounting. No host executables, implicit network, ambient files,
      native/WASM fallback or dynamic dependency downloads. Keep CLI and SDK
      behavior equivalent. TDD is required for code; unit tests use memfs or
      memory VFS and mocked external capabilities. Preserve unrelated edits.

      Compare saved HTML corpus output to pinned native wkhtmltopdf and an
      independent browser under declared font/assets profiles. Inspect
      screenshots for long tables, typography, images, page breaks, TOC, links
      and headers/footers. Validate PDF structure and link geometry separately;
      layout fidelity claims require visual evidence. Native processes are
      manual QA controls only; unit tests never spawn them or fetch fixtures.
      Record candidate revision, tool/runtime versions, exact fixture set,
      bytes/status/effects, missing cells and differences. Minimize failures and
      add fast regressions before repairs. Keep performance measurements
      separate from semantic proof.


      Self-contained researched semantics: Pin
      wkhtmltopdf024b2b2bb459dd904d15b911d04c6df4ff2c9031 archived2022.
      src/pdf/pdfarguments.cc flags, pdfcommandlineparser.cc object scopes,
      shared/commandlineparserbase.cc parseArg, pdf/wkhtmltopdf.cc batch
      tokenizer/main, lib/pdfsettings/loadsettings/websettings defaults,
      multipageloader.cc access/errors/waits, pdfconverter.cc
      margins/pagination/header/footer/copies/output. Source-derived only; no
      native executable control yet. Patched Qt macro changes multiple
      objects/outlines/headers/links/forms/TOC support; pin full binary/Qt patch
      profile before compatibility assertions. Defaults Portrait/A4(dimension
      source verify),96DPI,copies1/collate true,outline true
      depth4,imageDPI600/quality94,compression true; left/right10mm, top/bottom
      auto sentinel-1 then10mm without headers or measured HTML header+spacing.
      Header/footer Arial12/spacing0; TOC dotted lines/title Table of
      Contents/indent1em/fontScale0.8/forwardLinks true/back false. Web
      background/images/JS/smart shrinking true, plugins false. Loader JS
      delay200, zoom1, local-file blocking true, stop slow true, page-load
      abort/media ignore, screen media default. Parser leading global|page
      options create defaults cloned per object, page/cover input and toc
      objects followed by scoped options, last argv output exactly. Cover AFTER
      option parsing clears header/footer text/line/html and outline inclusion;
      not pagesCount automatically. Global-only flags after object fail
      incorrect location1. Long options exact token, not --key=value; short
      grouped options consume separate following operands (no generic attached
      -wN assumption). Pinned parseArg has argv[arg][2]=='0' ASCII zero, not
      NUL: bare -- appears unknown, --0... activates defaultMode; source-derived
      version quirk needs native control or deliberate safe '--' deviation.
      Unknown/missing/invalid/misplaced1 stderr. read-args-from-stdin custom
      state tokenizer: no shell expansion, backslash escapes one char even in
      single quotes, empty quoted tokens dropped, unmatched quotes accepted;
      each line combines original argv, fresh settings, stops first failed
      conversion1. Input/output '-' stdin/stdout, stdout may native tempfile
      spool, product own bounded VFS stage. All four margin units must match
      source, mixed units error (unit conversion extension explicit). Pixels at
      WebKit96 then dpi/96 device factor and zoom/smart-shrink; not CSS px=PDF
      pt. Native blocked local access canonicalizes path and ascends allowed
      ancestors; main input file autoallowed, denied replaced about:blank with
      warning. Product VFS identity-aware capabilities only, no host paths;
      enabled-local cannot escape VFS. URL/cookies/proxy/auth/custom
      headers/post/cert/cache options unsupported without explicit supplied
      bounded resources, no implicit network. Native SSL ignores errors; product
      must never recreate blanket bypass. Native
      scripts/run-script/alerts/window.status/printRequested alter load
      completion; no untrusted execution via JS eval or ambient DOM/browser.
      Declare static first-party renderer profile, reject dynamic execution
      flags or require separately approved safe harness capability, with
      explicit deviation. Loader waits status every50ms indefinitely then
      jsdelay; product explicit work/deadline/cancel bound. Forms and links
      inert output semantics; TOC native XSLT and outline need qualified source
      model, no external entity/URL fetch. Existing Pandoc HTML/PDF conversion
      uses external deps and simplified layout, not WebKit fidelity; do not
      wholesale import. First-party HTML5/CSS cascade/box/font/shaping/paged
      layout/writer engines required; static subset cannot be called full
      browser parity. Archived renderer lacks modern browser CSS; pinned legacy
      behavior distinct from modern standards.


      Independent additional findings: Exact source-derived statuses from
      src/lib/utilities.cc handleError: nonzero errorCode takes precedence over
      success; HTTP404 exits2, HTTP401 exits3, other HTTP errors exit1; network
      error codes stored as1000+QNetworkReply enum exit1 with symbolic network
      diagnostic. success=false/errorCode0 exits1 with unknown-error diagnostic;
      true/0 exits0. read-args-from-stdin batch branch bypasses helper,
      success0/failure1. Native patched-Qt execution still unqualified; do not
      flatten documented single-job statuses to a generic1.



      Pagination and outline source audit at wkhtmltopdf
      024b2b2bb459dd904d15b911d04c6df4ff2c9031: pdfconverter.cc preprocessPage
      records logical pageCount as zero when pagesCount=false, but printDocument
      prints actual QWebPrinter pages. spoolTo advances pageNumber only for
      counted objects. Collated copies repeat the whole document and reset
      logical pageNumber to 1; uncollated copies repeat each physical page
      before advancing. Cover clears headers/footers and includeInOutline, but
      does not automatically disable pagesCount. Outline has another counter:
      addEmptyWebPage adds a one-page placeholder, whereas replaceWebPage uses
      actual printer pageCount even for pagesCount=false. Therefore TOC prefix
      sums/header topage, logical numbering and physical output cannot be
      assumed identical. Preserve this distinction in compatibility controls or
      document an intentional corrected behavior.


      TOC is a fixed-point loop: loadTocs dumps outline XML, applies Qt XSLT
      2.0, loads generated HTML, and tocLoaded repeats if page count or outline
      differs. No source iteration bound was found; first-party implementation
      must enforce iteration/work budgets, cancellation and a convergence
      diagnostic. Supplied XSLT must not gain ambient files, entity resolution
      or network capabilities. Pin supported XSLT profile separately.


      outline.cc replaceWebPage selects h1 through h9 and sorts by rendered
      (page,y,x), not DOM order. Its QMap overwrites headings at identical
      coordinates. Empty text and page=-1 are omitted; LF becomes a space and
      surrounding whitespace is trimmed. A level stack attaches skipped heading
      levels to the preceding lower level. Anchor reuse compares subtree size,
      document, value and display; reused tocAnchor is assigned the previous
      anchor in this source, a suspected defect requiring an independent control
      rather than automatic imitation. Header section/subsection/subsubsection
      caches retain the first heading at each level on a page and carry it
      forward. Built-in header keys overwrite custom replacements of the same
      name. Date/time uses current local clock/system locale; first-party engine
      needs explicit clock and locale inputs.


      findLinks resolves href against frame base URL. Known input-document URLs
      become local destinations, with no-fragment body or fragment lookup in
      order a[name], any[id], any[name]; unmatched fragments in known documents
      are omitted instead of becoming external links. Other URLs are external if
      enabled, either resolved or original according to resolveRelativeLinks.
      Reserved __WKANCHOR_ names/hrefs have special handling. Test percent
      encoding, duplicate inputs, URL fragments containing selector syntax,
      absent targets and link geometry. These are source-only findings, not
      executed patched-Qt evidence; the unpatched branch prints only objects[0].



      Full pinned switch inventory:122 unique declarations,35 global/81 page/6
      TOC, including Unix-conditional use-xserver. Source traversal follows
      PdfCommandLineParser constructor and
      addDocArgs/addGlobalLoadArgs/addWebArgs/addPageLoadArgs with inherited
      mode/qthack state; it is source evidence, not patched-Qt execution.
      global: --help, --version, --license, --extended-help, --manpage,
      --htmldoc, --readme, --quiet, --log-level, --no-collate, --collate,
      --copies, --orientation, --page-size, --grayscale, --lowquality, --title,
      --read-args-from-stdin, --margin-bottom, --margin-left, --margin-right,
      --margin-top, --dpi, --page-height, --page-width, --cookie-jar,
      --image-quality, --image-dpi, --no-pdf-compression, --use-xserver,
      --outline, --no-outline, --outline-depth, --dump-outline,
      --dump-default-toc-xsl. page: --default-header, --viewport-size,
      --enable-plugins, --disable-plugins, --minimum-font-size,
      --user-style-sheet, --no-images, --images, --disable-javascript,
      --enable-javascript, --encoding, --no-background, --background,
      --include-in-outline, --exclude-from-outline, --disable-smart-shrinking,
      --enable-smart-shrinking, --print-media-type, --no-print-media-type,
      --enable-forms, --disable-forms, --disable-internal-links,
      --enable-internal-links, --disable-external-links,
      --enable-external-links, --resolve-relative-links, --keep-relative-links,
      --enable-toc-back-links, --disable-toc-back-links, --proxy,
      --proxy-hostname-lookup, --bypass-proxy-for, --username, --password,
      --ssl-key-path, --ssl-key-password, --ssl-crt-path, --load-error-handling,
      --load-media-error-handling, --custom-header, --custom-header-propagation,
      --no-custom-header-propagation, --javascript-delay, --window-status,
      --zoom, --cookie, --post, --post-file, --disable-local-file-access,
      --enable-local-file-access, --allow, --cache-dir, --debug-javascript,
      --no-debug-javascript, --stop-slow-scripts, --no-stop-slow-scripts,
      --run-script, --checkbox-svg, --checkbox-checked-svg, --radiobutton-svg,
      --radiobutton-checked-svg, --page-offset, --footer-center,
      --footer-font-name, --footer-font-size, --footer-left, --footer-line,
      --no-footer-line, --footer-right, --footer-spacing, --footer-html,
      --header-center, --header-font-name, --header-font-size, --header-left,
      --header-line, --no-header-line, --header-right, --header-spacing,
      --header-html, --replace. toc: --xsl-style-sheet, --toc-header-text,
      --disable-toc-links, --disable-dotted-lines, --toc-text-size-shrink,
      --toc-level-indentation. Retain every switch in the
      implementation/rejection matrix. Zero-argument ConstSetter/Caller,
      one-argument typed setters/list append, two-argument
      custom-header/cookie/post/post-file/replace; repeat map/list handlers
      APPEND entries, not overwrite in a JS object, so duplicate keys/order
      require controls. QStrSetter uses QString::fromLocal8Bit: explicit CLI
      encoding profile must replace ambient host conversion; literal Unicode SDK
      strings remain separate. IntSetter uses QString.toInt, FloatSetter uses
      toFloat and stores binary32; do not silently use arbitrary JS float
      precision for zoom/header spacing/TOC shrink. Unpatched parseArg invokes
      handler BEFORE printing unsupported-switch warning: the warning itself
      does not prove setting ignored, downstream macro branches decide effects.
      Native use-xserver also inherits qthack=true from preceding group;
      preserve source finding rather than correct inventory by intuition.
      Header/footer MapSetter replace entries append; same key substitutions
      require ordered source controls. Defaults/settings clones/cover clear
      semantics remain separate from option admission. Native Qt
      numeric/encoding boundary cases remain open; safe finite/checked
      validation deviations are explicit.
    status:
      test: done
  - id: ship-wkhtmltopdf
    title: Verify packed exports and document wkhtmltopdf capabilities
    prompt: >
      Keep this command in packages/safe-bash-command-wkhtmltopdf, with package
      name safe-bash-command-wkhtmltopdf, private: true and no external runtime
      dependencies. Follow docs/plans/safe-bash-command-package-pattern.md.
      Expose its API through @poe-platform/safe-bash/commands/wkhtmltopdf;
      safe-bash only composes and exports it. Bundle private workspace
      implementation and declarations into the safe-bash artifact so installed
      consumers never need an unpublished package. Do not publish the command
      package without explicit instruction. Use TypeScript ESM and byte streams,
      VFS-only I/O, explicit cancellation, invocation cleanup and bounded
      resource accounting. No host executables, implicit network, ambient files,
      native/WASM fallback or dynamic dependency downloads. Keep CLI and SDK
      behavior equivalent. TDD is required for code; unit tests use memfs or
      memory VFS and mocked external capabilities. Preserve unrelated edits.

      Add a compact user-facing package README with commands/examples, exact
      supported flags, limits, outputs and runtime profile. Update safe-bash
      existing usage/support sections as needed without adding unrelated
      sections. Use maintained package unit/lint/build routes; shared changes
      require full repository routes. Verify isolated packed
      @poe-platform/safe-bash subpath import and declarations without private
      workspace packages installed, including applicable browser/workerd
      conditions. Inspect adhoc CLI screenshots with npm run screenshot-poe-code
      for visible changes; use Markdown QA and inspect generated document
      screenshots when rendering is affected. Do not publish this private
      package or claim release from local verification.


      Self-contained researched semantics: Pin
      wkhtmltopdf024b2b2bb459dd904d15b911d04c6df4ff2c9031 archived2022.
      src/pdf/pdfarguments.cc flags, pdfcommandlineparser.cc object scopes,
      shared/commandlineparserbase.cc parseArg, pdf/wkhtmltopdf.cc batch
      tokenizer/main, lib/pdfsettings/loadsettings/websettings defaults,
      multipageloader.cc access/errors/waits, pdfconverter.cc
      margins/pagination/header/footer/copies/output. Source-derived only; no
      native executable control yet. Patched Qt macro changes multiple
      objects/outlines/headers/links/forms/TOC support; pin full binary/Qt patch
      profile before compatibility assertions. Defaults Portrait/A4(dimension
      source verify),96DPI,copies1/collate true,outline true
      depth4,imageDPI600/quality94,compression true; left/right10mm, top/bottom
      auto sentinel-1 then10mm without headers or measured HTML header+spacing.
      Header/footer Arial12/spacing0; TOC dotted lines/title Table of
      Contents/indent1em/fontScale0.8/forwardLinks true/back false. Web
      background/images/JS/smart shrinking true, plugins false. Loader JS
      delay200, zoom1, local-file blocking true, stop slow true, page-load
      abort/media ignore, screen media default. Parser leading global|page
      options create defaults cloned per object, page/cover input and toc
      objects followed by scoped options, last argv output exactly. Cover AFTER
      option parsing clears header/footer text/line/html and outline inclusion;
      not pagesCount automatically. Global-only flags after object fail
      incorrect location1. Long options exact token, not --key=value; short
      grouped options consume separate following operands (no generic attached
      -wN assumption). Pinned parseArg has argv[arg][2]=='0' ASCII zero, not
      NUL: bare -- appears unknown, --0... activates defaultMode; source-derived
      version quirk needs native control or deliberate safe '--' deviation.
      Unknown/missing/invalid/misplaced1 stderr. read-args-from-stdin custom
      state tokenizer: no shell expansion, backslash escapes one char even in
      single quotes, empty quoted tokens dropped, unmatched quotes accepted;
      each line combines original argv, fresh settings, stops first failed
      conversion1. Input/output '-' stdin/stdout, stdout may native tempfile
      spool, product own bounded VFS stage. All four margin units must match
      source, mixed units error (unit conversion extension explicit). Pixels at
      WebKit96 then dpi/96 device factor and zoom/smart-shrink; not CSS px=PDF
      pt. Native blocked local access canonicalizes path and ascends allowed
      ancestors; main input file autoallowed, denied replaced about:blank with
      warning. Product VFS identity-aware capabilities only, no host paths;
      enabled-local cannot escape VFS. URL/cookies/proxy/auth/custom
      headers/post/cert/cache options unsupported without explicit supplied
      bounded resources, no implicit network. Native SSL ignores errors; product
      must never recreate blanket bypass. Native
      scripts/run-script/alerts/window.status/printRequested alter load
      completion; no untrusted execution via JS eval or ambient DOM/browser.
      Declare static first-party renderer profile, reject dynamic execution
      flags or require separately approved safe harness capability, with
      explicit deviation. Loader waits status every50ms indefinitely then
      jsdelay; product explicit work/deadline/cancel bound. Forms and links
      inert output semantics; TOC native XSLT and outline need qualified source
      model, no external entity/URL fetch. Existing Pandoc HTML/PDF conversion
      uses external deps and simplified layout, not WebKit fidelity; do not
      wholesale import. First-party HTML5/CSS cascade/box/font/shaping/paged
      layout/writer engines required; static subset cannot be called full
      browser parity. Archived renderer lacks modern browser CSS; pinned legacy
      behavior distinct from modern standards.


      Independent additional findings: Exact source-derived statuses from
      src/lib/utilities.cc handleError: nonzero errorCode takes precedence over
      success; HTTP404 exits2, HTTP401 exits3, other HTTP errors exit1; network
      error codes stored as1000+QNetworkReply enum exit1 with symbolic network
      diagnostic. success=false/errorCode0 exits1 with unknown-error diagnostic;
      true/0 exits0. read-args-from-stdin batch branch bypasses helper,
      success0/failure1. Native patched-Qt execution still unqualified; do not
      flatten documented single-job statuses to a generic1.



      Pagination and outline source audit at wkhtmltopdf
      024b2b2bb459dd904d15b911d04c6df4ff2c9031: pdfconverter.cc preprocessPage
      records logical pageCount as zero when pagesCount=false, but printDocument
      prints actual QWebPrinter pages. spoolTo advances pageNumber only for
      counted objects. Collated copies repeat the whole document and reset
      logical pageNumber to 1; uncollated copies repeat each physical page
      before advancing. Cover clears headers/footers and includeInOutline, but
      does not automatically disable pagesCount. Outline has another counter:
      addEmptyWebPage adds a one-page placeholder, whereas replaceWebPage uses
      actual printer pageCount even for pagesCount=false. Therefore TOC prefix
      sums/header topage, logical numbering and physical output cannot be
      assumed identical. Preserve this distinction in compatibility controls or
      document an intentional corrected behavior.


      TOC is a fixed-point loop: loadTocs dumps outline XML, applies Qt XSLT
      2.0, loads generated HTML, and tocLoaded repeats if page count or outline
      differs. No source iteration bound was found; first-party implementation
      must enforce iteration/work budgets, cancellation and a convergence
      diagnostic. Supplied XSLT must not gain ambient files, entity resolution
      or network capabilities. Pin supported XSLT profile separately.


      outline.cc replaceWebPage selects h1 through h9 and sorts by rendered
      (page,y,x), not DOM order. Its QMap overwrites headings at identical
      coordinates. Empty text and page=-1 are omitted; LF becomes a space and
      surrounding whitespace is trimmed. A level stack attaches skipped heading
      levels to the preceding lower level. Anchor reuse compares subtree size,
      document, value and display; reused tocAnchor is assigned the previous
      anchor in this source, a suspected defect requiring an independent control
      rather than automatic imitation. Header section/subsection/subsubsection
      caches retain the first heading at each level on a page and carry it
      forward. Built-in header keys overwrite custom replacements of the same
      name. Date/time uses current local clock/system locale; first-party engine
      needs explicit clock and locale inputs.


      findLinks resolves href against frame base URL. Known input-document URLs
      become local destinations, with no-fragment body or fragment lookup in
      order a[name], any[id], any[name]; unmatched fragments in known documents
      are omitted instead of becoming external links. Other URLs are external if
      enabled, either resolved or original according to resolveRelativeLinks.
      Reserved __WKANCHOR_ names/hrefs have special handling. Test percent
      encoding, duplicate inputs, URL fragments containing selector syntax,
      absent targets and link geometry. These are source-only findings, not
      executed patched-Qt evidence; the unpatched branch prints only objects[0].



      Full pinned switch inventory:122 unique declarations,35 global/81 page/6
      TOC, including Unix-conditional use-xserver. Source traversal follows
      PdfCommandLineParser constructor and
      addDocArgs/addGlobalLoadArgs/addWebArgs/addPageLoadArgs with inherited
      mode/qthack state; it is source evidence, not patched-Qt execution.
      global: --help, --version, --license, --extended-help, --manpage,
      --htmldoc, --readme, --quiet, --log-level, --no-collate, --collate,
      --copies, --orientation, --page-size, --grayscale, --lowquality, --title,
      --read-args-from-stdin, --margin-bottom, --margin-left, --margin-right,
      --margin-top, --dpi, --page-height, --page-width, --cookie-jar,
      --image-quality, --image-dpi, --no-pdf-compression, --use-xserver,
      --outline, --no-outline, --outline-depth, --dump-outline,
      --dump-default-toc-xsl. page: --default-header, --viewport-size,
      --enable-plugins, --disable-plugins, --minimum-font-size,
      --user-style-sheet, --no-images, --images, --disable-javascript,
      --enable-javascript, --encoding, --no-background, --background,
      --include-in-outline, --exclude-from-outline, --disable-smart-shrinking,
      --enable-smart-shrinking, --print-media-type, --no-print-media-type,
      --enable-forms, --disable-forms, --disable-internal-links,
      --enable-internal-links, --disable-external-links,
      --enable-external-links, --resolve-relative-links, --keep-relative-links,
      --enable-toc-back-links, --disable-toc-back-links, --proxy,
      --proxy-hostname-lookup, --bypass-proxy-for, --username, --password,
      --ssl-key-path, --ssl-key-password, --ssl-crt-path, --load-error-handling,
      --load-media-error-handling, --custom-header, --custom-header-propagation,
      --no-custom-header-propagation, --javascript-delay, --window-status,
      --zoom, --cookie, --post, --post-file, --disable-local-file-access,
      --enable-local-file-access, --allow, --cache-dir, --debug-javascript,
      --no-debug-javascript, --stop-slow-scripts, --no-stop-slow-scripts,
      --run-script, --checkbox-svg, --checkbox-checked-svg, --radiobutton-svg,
      --radiobutton-checked-svg, --page-offset, --footer-center,
      --footer-font-name, --footer-font-size, --footer-left, --footer-line,
      --no-footer-line, --footer-right, --footer-spacing, --footer-html,
      --header-center, --header-font-name, --header-font-size, --header-left,
      --header-line, --no-header-line, --header-right, --header-spacing,
      --header-html, --replace. toc: --xsl-style-sheet, --toc-header-text,
      --disable-toc-links, --disable-dotted-lines, --toc-text-size-shrink,
      --toc-level-indentation. Retain every switch in the
      implementation/rejection matrix. Zero-argument ConstSetter/Caller,
      one-argument typed setters/list append, two-argument
      custom-header/cookie/post/post-file/replace; repeat map/list handlers
      APPEND entries, not overwrite in a JS object, so duplicate keys/order
      require controls. QStrSetter uses QString::fromLocal8Bit: explicit CLI
      encoding profile must replace ambient host conversion; literal Unicode SDK
      strings remain separate. IntSetter uses QString.toInt, FloatSetter uses
      toFloat and stores binary32; do not silently use arbitrary JS float
      precision for zoom/header spacing/TOC shrink. Unpatched parseArg invokes
      handler BEFORE printing unsupported-switch warning: the warning itself
      does not prove setting ignored, downstream macro branches decide effects.
      Native use-xserver also inherits qthack=true from preceding group;
      preserve source finding rather than correct inventory by intuition.
      Header/footer MapSetter replace entries append; same key substitutions
      require ordered source controls. Defaults/settings clones/cover clear
      semantics remain separate from option admission. Native Qt
      numeric/encoding boundary cases remain open; safe finite/checked
      validation deviations are explicit.
    status:
      implement: done
      refactor: done
      test: done
finalization: completed
name: safe-bash-wkhtmltopdf
state: archived
---


# HTML-to-PDF document rendering

Render saved HTML/CSS to PDF with an explicit first-party JS layout engine and controlled resources.

Prerequisites: Requires HTML/CSS/layout engines and existing PDF writer; a parser or screenshot wrapper does not supply browser-quality pagination.

The flags listed below are targets to verify against a pinned upstream version, not claims about current implementation. Maintain a feature/flag matrix with supported, not-yet-implemented and intentionally excluded entries plus exact failure behavior. No feature may disappear merely because a smaller subset passes. Complete the specified intended profile or obtain an explicit scope change.

Execution: tasks are ordered; prerequisite plans must pass their stated acceptance gates before dependent integration. Draft plans define work; tasks remain open until executed and verified. Do not mark implementation or compatibility complete from planning, unit counts, or an unexecuted native comparison.

Delivery: use maintained workspace checks and build closures; broad build/export infrastructure changes require npm test, repository lint and npm run build. Commit only task-owned paths in atomic Conventional Commits when assigned. Push only when instructed; report local commits, remote-main verification and successful releases separately. Private command packages remain unpublished. Store temporary outputs under out and purge them after review.

## Versioned parser/loader/rendering profile

Pin wkhtmltopdf024b2b2bb459dd904d15b911d04c6df4ff2c9031 archived2022. src/pdf/pdfarguments.cc flags, pdfcommandlineparser.cc object scopes, shared/commandlineparserbase.cc parseArg, pdf/wkhtmltopdf.cc batch tokenizer/main, lib/pdfsettings/loadsettings/websettings defaults, multipageloader.cc access/errors/waits, pdfconverter.cc margins/pagination/header/footer/copies/output. Source-derived only; no native executable control yet. Patched Qt macro changes multiple objects/outlines/headers/links/forms/TOC support; pin full binary/Qt patch profile before compatibility assertions. Defaults Portrait/A4(dimension source verify),96DPI,copies1/collate true,outline true depth4,imageDPI600/quality94,compression true; left/right10mm, top/bottom auto sentinel-1 then10mm without headers or measured HTML header+spacing. Header/footer Arial12/spacing0; TOC dotted lines/title Table of Contents/indent1em/fontScale0.8/forwardLinks true/back false. Web background/images/JS/smart shrinking true, plugins false. Loader JS delay200, zoom1, local-file blocking true, stop slow true, page-load abort/media ignore, screen media default. Parser leading global|page options create defaults cloned per object, page/cover input and toc objects followed by scoped options, last argv output exactly. Cover AFTER option parsing clears header/footer text/line/html and outline inclusion; not pagesCount automatically. Global-only flags after object fail incorrect location1. Long options exact token, not --key=value; short grouped options consume separate following operands (no generic attached -wN assumption). Pinned parseArg has argv[arg][2]=='0' ASCII zero, not NUL: bare -- appears unknown, --0... activates defaultMode; source-derived version quirk needs native control or deliberate safe '--' deviation. Unknown/missing/invalid/misplaced1 stderr. read-args-from-stdin custom state tokenizer: no shell expansion, backslash escapes one char even in single quotes, empty quoted tokens dropped, unmatched quotes accepted; each line combines original argv, fresh settings, stops first failed conversion1. Input/output '-' stdin/stdout, stdout may native tempfile spool, product own bounded VFS stage. All four margin units must match source, mixed units error (unit conversion extension explicit). Pixels at WebKit96 then dpi/96 device factor and zoom/smart-shrink; not CSS px=PDF pt. Native blocked local access canonicalizes path and ascends allowed ancestors; main input file autoallowed, denied replaced about:blank with warning. Product VFS identity-aware capabilities only, no host paths; enabled-local cannot escape VFS. URL/cookies/proxy/auth/custom headers/post/cert/cache options unsupported without explicit supplied bounded resources, no implicit network. Native SSL ignores errors; product must never recreate blanket bypass. Native scripts/run-script/alerts/window.status/printRequested alter load completion; no untrusted execution via JS eval or ambient DOM/browser. Declare static first-party renderer profile, reject dynamic execution flags or require separately approved safe harness capability, with explicit deviation. Loader waits status every50ms indefinitely then jsdelay; product explicit work/deadline/cancel bound. Forms and links inert output semantics; TOC native XSLT and outline need qualified source model, no external entity/URL fetch. Existing Pandoc HTML/PDF conversion uses external deps and simplified layout, not WebKit fidelity; do not wholesale import. First-party HTML5/CSS cascade/box/font/shaping/paged layout/writer engines required; static subset cannot be called full browser parity. Archived renderer lacks modern browser CSS; pinned legacy behavior distinct from modern standards.

[Object parser](https://github.com/wkhtmltopdf/wkhtmltopdf/blob/024b2b2bb459dd904d15b911d04c6df4ff2c9031/src/pdf/pdfcommandlineparser.cc), [option parser](https://github.com/wkhtmltopdf/wkhtmltopdf/blob/024b2b2bb459dd904d15b911d04c6df4ff2c9031/src/shared/commandlineparserbase.cc), [loader](https://github.com/wkhtmltopdf/wkhtmltopdf/blob/024b2b2bb459dd904d15b911d04c6df4ff2c9031/src/lib/multipageloader.cc), [converter](https://github.com/wkhtmltopdf/wkhtmltopdf/blob/024b2b2bb459dd904d15b911d04c6df4ff2c9031/src/lib/pdfconverter.cc). LGPL3 and Qt/WebKit/code/assets license closure must be audited before adaptation. No native Qt/browser/WASM engine authorized.

## Special-case matrix

- **W01**: Patched/unpatched feature warning versus ignored effect, multiple objects.
- **W02**: Global defaults cloned, page object overrides, cover clears headers and outline, TOC scopes.
- **W03**: Exact long option/grouped short/separate operands and bare-- versus --0 source quirk.
- **W04**: Batch physical lines/quotes/empty tokens/backslash/unmatched quote/no expansions/failure aggregate.
- **W05**: Input stdin versus literal'-'/URL/file/data resources and output stdout/stage/cancellation.
- **W06**: A4/named/custom dimensions/orientation/mm/in/cm/pt, mixed margin units and invalid numbers.
- **W07**: Auto top/bottom versus explicit margins, HTML header measuring and reserve height across objects.
- **W08**: DPI96 device factor/zoom/smart shrinking/viewport/text minimum sizes and rounding.
- **W09**: Screen versus print CSS/background/images/user stylesheet/font assets and charset.
- **W10**: CSS specificity/inheritance/inline/float/position/table/repeated headers/page-break behavior.
- **W11**: Legacy unsupported flex/grid/media/modern selectors explicit compatibility limits.
- **W12**: Headers page/topage/frompage/date/time/title/webpage/section/subsection tokens and replace ordering.
- **W13**: Copies collated versus uncollated, page offsets/count inclusion, blank pages and skipped loads.
- **W14**: Outline depth/anchors/links/relative URI/TOC XSLT repeated pagination convergence and back links.
- **W15**: Form checkbox/radio/text output and SVG assets, script/submit behavior inert.
- **W16**: Page abort/skip/ignore versus media extensions-ignore, HTTP/network code status mapping.
- **W17**: Blocked local symlink/ancestor allow rules, missing resource and warning/blank behavior.
- **W18**: JavaScript/run-script/window-status/delay/print signals denied or safe capability deviations.
- **W19**: Proxy/cookies/auth/custom-header propagation/post/cert/cache deny explicit no credential leaks.
- **W20**: PDF imageDPI/JPEG quality/grayscale/compression/title/meta and text/layout preservation.
- **W21**: Same source/dest/symlink/collisions/multi-object partial source reads and atomic publication.
- **W22**: Budget CSS/layout/reflow/pagination/assets/pixels/fonts/output and cleanup after sink failures.

Independent controls pin renderer binary/Qt patches, locale/timezone/clock/fonts and licensed offline HTML/resource fixtures. Compare PDF page geometry, text, outlines/forms and screenshots, not PDF bytes alone. Status mapping handleError and detailed Qt pagination/layout internals remain research gates. Keep full static document-rendering scope open until admitted cells pass; dynamic/host behavior is deliberate sandbox boundary, not silent ignored options.


## Additional independent controls

Exact source-derived statuses from src/lib/utilities.cc handleError: nonzero errorCode takes precedence over success; HTTP404 exits2, HTTP401 exits3, other HTTP errors exit1; network error codes stored as1000+QNetworkReply enum exit1 with symbolic network diagnostic. success=false/errorCode0 exits1 with unknown-error diagnostic; true/0 exits0. read-args-from-stdin batch branch bypasses helper, success0/failure1. Native patched-Qt execution still unqualified; do not flatten documented single-job statuses to a generic1.


## Pagination, outline and link audit

Pagination and outline source audit at wkhtmltopdf 024b2b2bb459dd904d15b911d04c6df4ff2c9031: pdfconverter.cc preprocessPage records logical pageCount as zero when pagesCount=false, but printDocument prints actual QWebPrinter pages. spoolTo advances pageNumber only for counted objects. Collated copies repeat the whole document and reset logical pageNumber to 1; uncollated copies repeat each physical page before advancing. Cover clears headers/footers and includeInOutline, but does not automatically disable pagesCount. Outline has another counter: addEmptyWebPage adds a one-page placeholder, whereas replaceWebPage uses actual printer pageCount even for pagesCount=false. Therefore TOC prefix sums/header topage, logical numbering and physical output cannot be assumed identical. Preserve this distinction in compatibility controls or document an intentional corrected behavior.

TOC is a fixed-point loop: loadTocs dumps outline XML, applies Qt XSLT 2.0, loads generated HTML, and tocLoaded repeats if page count or outline differs. No source iteration bound was found; first-party implementation must enforce iteration/work budgets, cancellation and a convergence diagnostic. Supplied XSLT must not gain ambient files, entity resolution or network capabilities. Pin supported XSLT profile separately.

outline.cc replaceWebPage selects h1 through h9 and sorts by rendered (page,y,x), not DOM order. Its QMap overwrites headings at identical coordinates. Empty text and page=-1 are omitted; LF becomes a space and surrounding whitespace is trimmed. A level stack attaches skipped heading levels to the preceding lower level. Anchor reuse compares subtree size, document, value and display; reused tocAnchor is assigned the previous anchor in this source, a suspected defect requiring an independent control rather than automatic imitation. Header section/subsection/subsubsection caches retain the first heading at each level on a page and carry it forward. Built-in header keys overwrite custom replacements of the same name. Date/time uses current local clock/system locale; first-party engine needs explicit clock and locale inputs.

findLinks resolves href against frame base URL. Known input-document URLs become local destinations, with no-fragment body or fragment lookup in order a[name], any[id], any[name]; unmatched fragments in known documents are omitted instead of becoming external links. Other URLs are external if enabled, either resolved or original according to resolveRelativeLinks. Reserved __WKANCHOR_ names/hrefs have special handling. Test percent encoding, duplicate inputs, URL fragments containing selector syntax, absent targets and link geometry. These are source-only findings, not executed patched-Qt evidence; the unpatched branch prints only objects[0].


## Complete pinned switch inventory

Source-derived declarations at revision `024b2b2bb459dd904d15b911d04c6df4ff2c9031`; `src/pdf/pdfarguments.cc` and `src/shared/commonarguments.cc`. Arity is separate following operands. Qt marks describe registration metadata, not proof that a downstream effect exists. `use-xserver` is conditional on Q_OS_UNIX.

| Switch | Short | Scope | Arity | Patched-Qt mark |
| --- | --- | --- | ---: | --- |
| --help | h | global | 0 | false |
| --version | V | global | 0 | false |
| --license |  | global | 0 | false |
| --extended-help | H | global | 0 | false |
| --manpage |  | global | 0 | false |
| --htmldoc |  | global | 0 | false |
| --readme |  | global | 0 | false |
| --quiet | q | global | 0 | false |
| --log-level |  | global | 1 | false |
| --no-collate |  | global | 0 | false |
| --collate |  | global | 0 | false |
| --copies |  | global | 1 | false |
| --orientation | O | global | 1 | false |
| --page-size | s | global | 1 | false |
| --grayscale | g | global | 0 | false |
| --lowquality | l | global | 0 | false |
| --title |  | global | 1 | false |
| --read-args-from-stdin |  | global | 0 | false |
| --margin-bottom | B | global | 1 | false |
| --margin-left | L | global | 1 | false |
| --margin-right | R | global | 1 | false |
| --margin-top | T | global | 1 | false |
| --dpi | d | global | 1 | false |
| --page-height |  | global | 1 | false |
| --page-width |  | global | 1 | false |
| --cookie-jar |  | global | 1 | false |
| --image-quality |  | global | 1 | true |
| --image-dpi |  | global | 1 | true |
| --no-pdf-compression |  | global | 0 | true |
| --use-xserver |  | global | 0 | true |
| --outline |  | global | 0 | true |
| --no-outline |  | global | 0 | true |
| --outline-depth |  | global | 1 | true |
| --dump-outline |  | global | 1 | true |
| --dump-default-toc-xsl |  | global | 0 | true |
| --default-header |  | page | 0 | true |
| --viewport-size |  | page | 1 | true |
| --enable-plugins |  | page | 0 | false |
| --disable-plugins |  | page | 0 | false |
| --minimum-font-size |  | page | 1 | false |
| --user-style-sheet |  | page | 1 | false |
| --no-images |  | page | 0 | false |
| --images |  | page | 0 | false |
| --disable-javascript | n | page | 0 | false |
| --enable-javascript |  | page | 0 | false |
| --encoding |  | page | 1 | false |
| --no-background |  | page | 0 | false |
| --background |  | page | 0 | false |
| --include-in-outline |  | page | 0 | true |
| --exclude-from-outline |  | page | 0 | true |
| --disable-smart-shrinking |  | page | 0 | true |
| --enable-smart-shrinking |  | page | 0 | true |
| --print-media-type |  | page | 0 | true |
| --no-print-media-type |  | page | 0 | true |
| --enable-forms |  | page | 0 | true |
| --disable-forms |  | page | 0 | true |
| --disable-internal-links |  | page | 0 | true |
| --enable-internal-links |  | page | 0 | true |
| --disable-external-links |  | page | 0 | true |
| --enable-external-links |  | page | 0 | true |
| --resolve-relative-links |  | page | 0 | true |
| --keep-relative-links |  | page | 0 | true |
| --enable-toc-back-links |  | page | 0 | true |
| --disable-toc-back-links |  | page | 0 | true |
| --proxy | p | page | 1 | false |
| --proxy-hostname-lookup |  | page | 0 | false |
| --bypass-proxy-for |  | page | 1 | false |
| --username |  | page | 1 | false |
| --password |  | page | 1 | false |
| --ssl-key-path |  | page | 1 | false |
| --ssl-key-password |  | page | 1 | false |
| --ssl-crt-path |  | page | 1 | false |
| --load-error-handling |  | page | 1 | false |
| --load-media-error-handling |  | page | 1 | false |
| --custom-header |  | page | 2 | false |
| --custom-header-propagation |  | page | 0 | false |
| --no-custom-header-propagation |  | page | 0 | false |
| --javascript-delay |  | page | 1 | false |
| --window-status |  | page | 1 | false |
| --zoom |  | page | 1 | false |
| --cookie |  | page | 2 | false |
| --post |  | page | 2 | false |
| --post-file |  | page | 2 | false |
| --disable-local-file-access |  | page | 0 | false |
| --enable-local-file-access |  | page | 0 | false |
| --allow |  | page | 1 | false |
| --cache-dir |  | page | 1 | false |
| --debug-javascript |  | page | 0 | false |
| --no-debug-javascript |  | page | 0 | false |
| --stop-slow-scripts |  | page | 0 | false |
| --no-stop-slow-scripts |  | page | 0 | false |
| --run-script |  | page | 1 | false |
| --checkbox-svg |  | page | 1 | false |
| --checkbox-checked-svg |  | page | 1 | false |
| --radiobutton-svg |  | page | 1 | false |
| --radiobutton-checked-svg |  | page | 1 | false |
| --page-offset |  | page | 1 | false |
| --footer-center |  | page | 1 | true |
| --footer-font-name |  | page | 1 | true |
| --footer-font-size |  | page | 1 | true |
| --footer-left |  | page | 1 | true |
| --footer-line |  | page | 0 | true |
| --no-footer-line |  | page | 0 | true |
| --footer-right |  | page | 1 | true |
| --footer-spacing |  | page | 1 | true |
| --footer-html |  | page | 1 | true |
| --header-center |  | page | 1 | true |
| --header-font-name |  | page | 1 | true |
| --header-font-size |  | page | 1 | true |
| --header-left |  | page | 1 | true |
| --header-line |  | page | 0 | true |
| --no-header-line |  | page | 0 | true |
| --header-right |  | page | 1 | true |
| --header-spacing |  | page | 1 | true |
| --header-html |  | page | 1 | true |
| --replace |  | page | 2 | true |
| --xsl-style-sheet |  | toc | 1 | true |
| --toc-header-text |  | toc | 1 | true |
| --disable-toc-links |  | toc | 0 | true |
| --disable-dotted-lines |  | toc | 0 | true |
| --toc-text-size-shrink |  | toc | 1 | true |
| --toc-level-indentation |  | toc | 1 | true |


Full pinned switch inventory:122 unique declarations,35 global/81 page/6 TOC, including Unix-conditional use-xserver. Source traversal follows PdfCommandLineParser constructor and addDocArgs/addGlobalLoadArgs/addWebArgs/addPageLoadArgs with inherited mode/qthack state; it is source evidence, not patched-Qt execution. global: --help, --version, --license, --extended-help, --manpage, --htmldoc, --readme, --quiet, --log-level, --no-collate, --collate, --copies, --orientation, --page-size, --grayscale, --lowquality, --title, --read-args-from-stdin, --margin-bottom, --margin-left, --margin-right, --margin-top, --dpi, --page-height, --page-width, --cookie-jar, --image-quality, --image-dpi, --no-pdf-compression, --use-xserver, --outline, --no-outline, --outline-depth, --dump-outline, --dump-default-toc-xsl. page: --default-header, --viewport-size, --enable-plugins, --disable-plugins, --minimum-font-size, --user-style-sheet, --no-images, --images, --disable-javascript, --enable-javascript, --encoding, --no-background, --background, --include-in-outline, --exclude-from-outline, --disable-smart-shrinking, --enable-smart-shrinking, --print-media-type, --no-print-media-type, --enable-forms, --disable-forms, --disable-internal-links, --enable-internal-links, --disable-external-links, --enable-external-links, --resolve-relative-links, --keep-relative-links, --enable-toc-back-links, --disable-toc-back-links, --proxy, --proxy-hostname-lookup, --bypass-proxy-for, --username, --password, --ssl-key-path, --ssl-key-password, --ssl-crt-path, --load-error-handling, --load-media-error-handling, --custom-header, --custom-header-propagation, --no-custom-header-propagation, --javascript-delay, --window-status, --zoom, --cookie, --post, --post-file, --disable-local-file-access, --enable-local-file-access, --allow, --cache-dir, --debug-javascript, --no-debug-javascript, --stop-slow-scripts, --no-stop-slow-scripts, --run-script, --checkbox-svg, --checkbox-checked-svg, --radiobutton-svg, --radiobutton-checked-svg, --page-offset, --footer-center, --footer-font-name, --footer-font-size, --footer-left, --footer-line, --no-footer-line, --footer-right, --footer-spacing, --footer-html, --header-center, --header-font-name, --header-font-size, --header-left, --header-line, --no-header-line, --header-right, --header-spacing, --header-html, --replace. toc: --xsl-style-sheet, --toc-header-text, --disable-toc-links, --disable-dotted-lines, --toc-text-size-shrink, --toc-level-indentation. Retain every switch in the implementation/rejection matrix. Zero-argument ConstSetter/Caller, one-argument typed setters/list append, two-argument custom-header/cookie/post/post-file/replace; repeat map/list handlers APPEND entries, not overwrite in a JS object, so duplicate keys/order require controls. QStrSetter uses QString::fromLocal8Bit: explicit CLI encoding profile must replace ambient host conversion; literal Unicode SDK strings remain separate. IntSetter uses QString.toInt, FloatSetter uses toFloat and stores binary32; do not silently use arbitrary JS float precision for zoom/header spacing/TOC shrink. Unpatched parseArg invokes handler BEFORE printing unsupported-switch warning: the warning itself does not prove setting ignored, downstream macro branches decide effects. Native use-xserver also inherits qthack=true from preceding group; preserve source finding rather than correct inventory by intuition. Header/footer MapSetter replace entries append; same key substitutions require ordered source controls. Defaults/settings clones/cover clear semantics remain separate from option admission. Native Qt numeric/encoding boundary cases remain open; safe finite/checked validation deviations are explicit.


## Supplemental source receipts

These selected source bytes were hash-checked before research scratch cleanup. This is a sparse source inventory, not native behavior qualification or the full upstream tree.

| Source at pinned revision | SHA256 |
| --- | --- |
| [src/shared/arghandler.inl](https://github.com/wkhtmltopdf/wkhtmltopdf/blob/024b2b2bb459dd904d15b911d04c6df4ff2c9031/src/shared/arghandler.inl) | `8c2cb87bb6ca9aac05c3415f87f0ac152d6ac0fe5b0e17ef53e77a431b6c31e8` |
| [src/shared/commandlineparserbase.hh](https://github.com/wkhtmltopdf/wkhtmltopdf/blob/024b2b2bb459dd904d15b911d04c6df4ff2c9031/src/shared/commandlineparserbase.hh) | `2317c7691f40c698b4e18cd037c1e8f9f3e54eb3a65fa710c042933c4a7c2a22` |


## Research acceptance specification

The [pinned semantics and acceptance specification](safe-bash-wkhtmltopdf-research.md) records the current-main inspection, fresh source receipts, exact parser/status diagnostics, memory-VFS fixture definitions, incremental HTML/CSS gates and all 122 switch dispositions. Native binary/Qt execution remains unqualified; implementation and compatibility tasks remain open.
