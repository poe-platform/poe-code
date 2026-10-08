import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as sb from "@poe-platform/safe-bash";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
export { sb };
import { astGrepCommands } from "@poe-platform/safe-bash/commands/ast-grep";
import { csvcutCommands } from "@poe-platform/safe-bash/commands/csvcut";
import { csvgrepCommands } from "@poe-platform/safe-bash/commands/csvgrep";
import { csvkitCommands } from "@poe-platform/safe-bash/commands/csvkit";
import { diff3Commands } from "@poe-platform/safe-bash/commands/diff3";
import { exiftoolCommands } from "@poe-platform/safe-bash/commands/exiftool";
import { htmlqCommands } from "@poe-platform/safe-bash/commands/htmlq";
import { imagemagickCommands } from "@poe-platform/safe-bash/commands/imagemagick";
import { mmdcCommands } from "@poe-platform/safe-bash/commands/mmdc";
import { pdfimagesCommands } from "@poe-platform/safe-bash/commands/pdfimages";
import { pdfinfoCommands } from "@poe-platform/safe-bash/commands/pdfinfo";
import { pdftkCommands } from "@poe-platform/safe-bash/commands/pdftk";
import { pdftoppmCommands } from "@poe-platform/safe-bash/commands/pdftoppm";
import { pdftotextCommands } from "@poe-platform/safe-bash/commands/pdftotext";
import { qpdfCommands } from "@poe-platform/safe-bash/commands/qpdf";
import { sipsCommands } from "@poe-platform/safe-bash/commands/sips";
import { unrtfCommands } from "@poe-platform/safe-bash/commands/unrtf";
import { pdfAstWkhtmltopdfCommands } from "@poe-platform/safe-bash/commands/wkhtmltopdf";
import { ffmpegCommands } from "@poe-platform/safe-bash/commands/ffmpeg";
import { sofficeCommands } from "@poe-platform/safe-bash/commands/soffice";
import { xanCommands } from "@poe-platform/safe-bash/commands/xan";
import { createXzCommands } from "@poe-platform/safe-bash/commands/xz";
import { soxCommands } from "@poe-platform/safe-bash/commands/sox";
import { soxiCommands } from "@poe-platform/safe-bash/commands/soxi";
import { qrencodeCommands } from "@poe-platform/safe-bash/commands/qrencode";
import { createDeviceFileSystem } from "@poe-platform/safe-bash/devices";
import { arraysExtension } from "@poe-platform/safe-bash/arrays";
import { jobsExtension } from "@poe-platform/safe-bash/jobs";
import { mapfileExtension } from "@poe-platform/safe-bash/mapfile";
import { installCommands } from "@poe-platform/safe-bash/install";
import { readExtension } from "@poe-platform/safe-bash/read";
import { trapExtension } from "@poe-platform/safe-bash/trap";
import {
  BenchmarkRecorder,
  measureSingleExec,
  type ExecPerformanceSample,
} from "./benchmark.js";

export interface E2EFileEntry {
  readonly content: string | Uint8Array;
  readonly mode?: number;
  readonly mtime?: Date;
}

export type E2EFileInit = string | Uint8Array | E2EFileEntry;

export interface E2EHarnessOptions {
  readonly files?: Readonly<Record<string, E2EFileInit>>;
  readonly directories?: readonly string[];
  readonly symlinks?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly limits?: sb.ShellLimits;
  readonly fs?: sb.FileSystem;
  readonly memoryFsOptions?: ConstructorParameters<typeof sb.MemoryFileSystem>[0];
  readonly mountDev?: boolean;
  readonly shellExtensions?: boolean;
  readonly bareShell?: boolean;
  readonly warmBeforeExec?: boolean;
  readonly includeExtendedCommands?: boolean;
  readonly plugins?: readonly sb.VirtualShellPlugin[];
  readonly benchmarkRecorder?: BenchmarkRecorder;
  readonly backgroundJobs?: boolean;
}

export interface E2EExecResult extends sb.ShellResult {
  readonly metrics: ExecPerformanceSample;
}

export interface TreeSnapshotEntry {
  readonly kind: "file" | "directory" | "symlink";
  readonly size: number;
  readonly mode: number;
  readonly sha256?: string;
  readonly text?: string;
  readonly target?: string;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
const utf8Encoder = new TextEncoder();

const PURE_RUST_SUITE_FILES = [
  "adversarial-parser-quoting-fuzz.test.ts",
  "shell-grammar-expansion.test.ts",
  "pipelines-redirections-streams.test.ts",
  "shell-parser-expansion-quoting-heredoc-redirection-torture-matrix.test.ts",
  "bare-shell-fastpath-cache-invalidation-regression-matrix.test.ts",
  "bare-shell-fastpath-cache-invalidation-stress-matrix.test.ts",
  "shell-arrays-assoc-mapfile-read-trap-subshell-scope-matrix.test.ts",
  "shell-builtins-arrays-mapfile-read-trap-jobs-subshell-matrix.test.ts",
  "shell-builtins-trap-getopts-printf-read-mapfile-declare-matrix.test.ts",
  "errexit-nounset-pipefail-subshell-scoping-matrix.test.ts",
  "shell-traps-jobs-arrays-read-mapfile.test.ts",
  "concurrency-subshells-job-control.test.ts",
  "posix-builtins-special-semantics.test.ts",
  "shell-builtins-redirections-process-substitution-edge-cases.test.ts",
  "posix-sh-bash-compliance-limits-signals-subshell-matrix.test.ts",
  "budgets-cancellation-chaos.test.ts",
  "sync-fastpath-shell-loop-redirect-pipe-matrix.test.ts",
  "find-rg-pure-pipeline-fastpath-parity-matrix.test.ts",
  "safe-bash-rust-wasm-parity-matrix.test.ts",
  "rg-grep-fd-find-search-traversal-matrix.test.ts",
  "text-columns-sort-uniq-join-cut-paste-comm-tr-matrix.test.ts",
  "search-find-xargs-refactor.test.ts",
  "search-rg-grep-fd-find-tree-du-stat-file-glob-ignore-matrix.test.ts",
  "diff-patch-merge-workflows.test.ts",
  "diff-patch-diff3-apply-patch-merge-conflict-matrix.test.ts",
  "diff-patch-diff3-apply-patch-workflow-matrix.test.ts",
  "text-processing-awk-sed.test.ts",
  "git-diff-patch-sed-awk-grep-find-xargs-end-to-end-repo-refactoring.test.ts",
  "graph-sorting-splitting-formatting.test.ts",
  "tsort-factor-expr-pr-iconv-line-endings-getopt-coreutils-matrix.test.ts",
  "xargs-env-timeout-date-seq-shuf-split-csplit-matrix.test.ts",
  "math-system-utilities.test.ts",
  "yq-fd-envsubst-sponge-numfmt-cal-pathchk-extended-cli-matrix.test.ts",
  "posix-gnu-oracle-differential-parity.test.ts",
  "unicode-locale-byte-safety.test.ts",
  "archives-compression-integrity.test.ts",
  "real-world-agent-workflows.test.ts",
  "session-state-persistence-snapshots.test.ts",
  "vfs-isolation-mounts-overlays.test.ts",
  "yq-toml-yaml-csv-xml-json-cross-format-conversion-matrix.test.ts",
  "csv-data-science-csvkit-mlr.test.ts",
  "coreutils-text-table-bytes-encoding-formatting-deep-matrix.test.ts",
  "sponge-htmlq-exiftool-jq-yq-rg-structured-media-pipeline-matrix.test.ts",
  "structured-data-yq-csvkit-xan-htmlq-sqlite3-matrix.test.ts",
  "xml-html-markdown-xpath-transform-pipeline-matrix.test.ts",
  "html-xml-web-scraping.test.ts",
  "html-xml-markdown-xpath-css-selector-web-scraping-matrix.test.ts",
  "yq-xml-xan-csvkit-sqlite-cross-format-matrix.test.ts",
  "structured-data-jq-yq-xml-csv.test.ts",
  "xan-csvkit-csvcut-csvgrep-tabular-analytics-edge-matrix.test.ts",
  "apply-patch-xan-tabular-workflows.test.ts",
  "bytes-encoding-checksums-hexdump-xxd-od-iconv-line-endings-matrix.test.ts",
  "binary-inspection-encoding-crypto-streams.test.ts",
  "encoding-crypto-binary-xxd-od-hexdump-iconv-matrix.test.ts",
  "awk-sed-jq-xan-csvkit-data-processing-deep-matrix.test.ts",
  "bc-dc-expr-numfmt-factor-math-pipeline-matrix.test.ts",
  "text-coreutils-sort-join-comm-cut-tr-edge-matrix.test.ts",
  "awk-sed-jq-fastpath-cache-isolation-matrix.test.ts",
  "sed-awk-grep-jq-fastpath-address-range-regression-matrix.test.ts",
  "awk-sed-jq-text-programs-structured-deep-matrix.test.ts",
  "diff3-unrtf-xmllint-numfmt-od-xxd-dd-bc-binary-doc-matrix.test.ts",
  "awk-sed-advanced-programming.test.ts",
  "diff-diff3-patch-cmp-comm-join-paste-merge-conflict-matrix.test.ts",
  "diff-patch-diff3-apply-patch-edge-matrix.test.ts",
  "sqlite3-bc-tar-archive-compression-crypto-pipeline-matrix.test.ts",
  "filesystem-coreutils-cp-mv-rm-ln-ls-chmod-stat-tree-matrix.test.ts",
  "archive-tar-zip-unzip-gzip-bzip2-xz-zstd-roundtrip-matrix.test.ts",
  "grep-family-regex-engines.test.ts",
  "tar-gzip-bzip2-xz-zstd-zip-unzip-sha512sum-archive-integrity-matrix.test.ts",
  "archive-compression-tar-zip-gzip-bzip2-xz-zstd-matrix.test.ts",
  "tar-gzip-xz-zstd-bzip2-zip-unzip-archive-pipeline-matrix.test.ts",
  "archive-tar-zip-gzip-bzip2-xz-edge-matrix.test.ts",
  "archive-tar-zip-compression-formats.test.ts",
  "search-rg-grep-find-fd-edge-matrix.test.ts",
  "coreutils-filesystem-printf-formatting.test.ts",
  "posix-system-env-cal-pathchk-getconf-locale-df-id-uname-less-fd-matrix.test.ts",
  "csvkit-csvcut-csvgrep-csvstat-csvjoin-csvsort-csvsql-xan-tabular-matrix.test.ts",
  "sed-awk-jq-advanced-program-matrix.test.ts",
  "jq-yq-xq-complex-queries.test.ts",
  "jq-yq-htmlq-xml-toml-yaml-csv-structured-query-matrix.test.ts",
  "jq-yq-structured-query-transformation-matrix.test.ts",
  "shell-middleware-plugins-capabilities-command-limits.test.ts",
  "database-sqlite3-analytics.test.ts",
  "filesystem-bridges-s3-webdav-virtual-devices.test.ts",
  "network-curl-wget-llm-op-workflows.test.ts",
  "node-python-safejs-sandboxes.test.ts",
  "op-1password-cli-vault-item-document-secret-inject-run-matrix.test.ts",
  "playwright-cli-browser-automation-storage-routing-tracing-matrix.test.ts",
  "python-node-safejs-polyglot-scripting-vfs-bridge-matrix.test.ts",
  "benchmark-suite.test.ts",
  "sqlite3-advanced-sql-window-cte-triggers.test.ts",
  "sqlite3-sql-window-cte-triggers-fk-json-fts-matrix.test.ts",
  "sqlite3-sql-ddl-dml-cte-window-triggers-fts-json-matrix.test.ts",
  "document-media-conversion-pipelines.test.ts",
  "docx-pptx-pdf-imagemagick-deep-workflows.test.ts",
  "media-document-pdf-image-audio-exif-soffice-matrix.test.ts",
  "imagemagick-sips-exiftool-mmdc-ffmpeg-soffice-media-document-matrix.test.ts",
  "ffmpeg-audio-video-media-pipelines.test.ts",
  "pdf-qpdf-pdftk-pdfinfo-pdftotext-pdfimages-pdftoppm-wkhtmltopdf-matrix.test.ts",
  "media-pdf-image-audio-video-office-document-pipeline-matrix.test.ts",
  "soffice-office-document-workflows.test.ts",
  "obscure-bash-expansion-ifs-nameref-extglob-trap-matrix.test.ts",
  "obscure-awk-sed-jq-sqlite-coreutils-edge-matrix.test.ts",
  "obscure-xan-csvkit-yq-xq-htmlq-archive-patch-matrix.test.ts",
  "obscure-shell-getopts-noclobber-fd-case-fallthrough-matrix.test.ts",
  "obscure-builtins-printf-read-mapfile-arith-declare-matrix.test.ts",
  "obscure-media-pdf-image-office-sponge-envsubst-matrix.test.ts",
  "obscure-sqlite3-triggers-fk-upsert-fts5-json-window-matrix.test.ts",
  "obscure-rg-grep-find-fd-xargs-filesystem-perms-matrix.test.ts",
  "obscure-jq-awk-sed-bc-text-pipeline-matrix.test.ts",
  "obscure-diff-patch-tar-zip-hash-xxd-coreutils-matrix.test.ts",
  "obscure-bash-arrays-subshells-pipelines-redirections-scoping-matrix.test.ts",
  "obscure-yq-xq-xmllint-htmlq-csvkit-xan-structured-matrix.test.ts",
  "obscure-pdf-image-ffmpeg-soffice-exiftool-media-doc-matrix.test.ts",
  "obscure-coreutils-sort-join-comm-cut-tr-nl-pr-column-fmt-matrix.test.ts",
  "obscure-sqlite3-recursive-cte-savepoint-alter-views-indexes-matrix.test.ts",
  "obscure-htmlq-xmllint-jq-yq-tomlq-csvkit-structured-matrix.test.ts",
  "obscure-xan-tabular-join-groupby-pivot-top-bins-matrix.test.ts",
  "obscure-bc-dc-expr-numfmt-factor-seq-shuf-envsubst-pathchk-cal-matrix.test.ts",
  "obscure-rg-grep-fd-find-tree-du-stat-file-glob-ignore-matrix.test.ts",
  "obscure-archive-crypto-binary-tar-gzip-zip-xxd-od-base64-dd-matrix.test.ts",
  "obscure-shell-parameter-expansion-quoting-redirection-pipeline-matrix.test.ts",
  "obscure-awk-sed-diff-patch-diff3-cmp-comm-join-text-matrix.test.ts",
  "obscure-posix-system-which-type-timeout-env-xargs-install-date-matrix.test.ts",
  "obscure-polyglot-sqlite3-jq-yq-xan-awk-sed-rg-archive-pipeline-matrix.test.ts",
  "obscure-jq-yq-xq-xmllint-htmlq-deep-filters-matrix.test.ts",
  "obscure-bash-builtins-control-flow-subshell-arithmetic-matrix.test.ts",
  "obscure-sqlite3-json-cte-window-upsert-triggers-views-matrix.test.ts",
  "obscure-xan-csvkit-tabular-analytics-pipeline-matrix.test.ts",
  "obscure-awk-sed-grep-rg-text-processing-pipeline-matrix.test.ts",
  "obscure-archive-diff-patch-crypto-filesystem-find-fd-matrix.test.ts",
  "obscure-pdf-image-ffmpeg-soffice-mmdc-exiftool-media-doc-pipeline-matrix.test.ts",
  "obscure-end-to-end-data-engineering-etl-audit-pipeline-matrix.test.ts",
  "obscure-shell-redirections-fd-heredoc-process-subst-trap-matrix.test.ts",
  "obscure-coreutils-date-cal-pr-fmt-csplit-tsort-getopt-iconv-matrix.test.ts",
  "obscure-sort-uniq-join-comm-cut-paste-column-tr-nl-wc-matrix.test.ts",
  "obscure-bc-dc-math-awk-jq-sqlite-numerical-scientific-matrix.test.ts",
  "obscure-yq-xq-xmllint-htmlq-html-to-markdown-unrtf-doc-structured-matrix.test.ts",
  "obscure-diff-diff3-patch-apply-patch-cmp-repo-merge-matrix.test.ts",
  "obscure-tar-zip-gzip-bzip2-xz-zstd-dd-base64-base32-crypto-archive-matrix.test.ts",
  "obscure-rg-grep-find-fd-xargs-tree-du-stat-chmod-ln-vfs-matrix.test.ts",
  "obscure-awk-sed-perl-style-text-state-machines-regex-matrix.test.ts",
  "obscure-sqlite3-window-cte-triggers-fk-upsert-fts5-json-analytics-matrix.test.ts",
  "obscure-xan-csvkit-csvlook-csvstat-csvsql-csvgrep-csvjoin-tabular-matrix.test.ts",
  "obscure-pdf-image-ffmpeg-soffice-mmdc-exiftool-magick-media-doc-matrix.test.ts",
  "obscure-shell-trap-errexit-pipefail-subshell-coproc-nameref-arrays-matrix.test.ts",
  "obscure-jq-yq-xq-xmllint-htmlq-tomlq-structured-query-transformation-matrix.test.ts",
  "obscure-polyglot-full-stack-incident-forensics-etl-audit-pipeline-matrix.test.ts",
  "obscure-coreutils-math-crypto-encoding-text-formatting-matrix.test.ts",
  "obscure-filesystem-globbing-extglob-symlinks-perms-umask-fd-heredoc-matrix.test.ts",
  "obscure-sql-csv-json-xml-yaml-awk-sed-multi-stage-analytics-matrix.test.ts",
  "obscure-bash-arithmetic-bitwise-arrays-printf-read-getopts-builtins-matrix.test.ts",
  "obscure-archive-diff-patch-crypto-binary-encoding-pipeline-matrix.test.ts",
  "obscure-rg-grep-find-fd-awk-sed-regex-backref-multiline-context-matrix.test.ts",
  "obscure-sqlite3-json-fts5-triggers-views-savepoint-upsert-window-matrix.test.ts",
  "obscure-xan-csvkit-jq-yq-xq-xmllint-htmlq-structured-document-matrix.test.ts",
  "obscure-pdf-image-ffmpeg-soffice-mmdc-exiftool-sips-media-pipeline-matrix.test.ts",
  "obscure-awk-sed-bc-numfmt-expr-coreutils-text-formatting-matrix.test.ts",
  "obscure-shell-traps-errexit-pipefail-subshells-arrays-nameref-fd-matrix.test.ts",
  "obscure-polyglot-secops-sbom-cve-incident-audit-archive-pipeline-matrix.test.ts",
  "obscure-posix-expansion-ifs-brace-glob-heredoc-eval-trap-subshell-matrix.test.ts",
  "obscure-xan-csvkit-sqlite3-jq-yq-analytics-join-pivot-window-matrix.test.ts",
  "obscure-awk-sed-grep-rg-find-fd-xargs-diff-patch-text-refactor-matrix.test.ts",
  "obscure-media-pdf-image-video-audio-office-diagram-metadata-matrix.test.ts",
  "obscure-archive-crypto-math-binary-coreutils-system-tools-matrix.test.ts",
  "obscure-sqlite3-fts5-triggers-savepoint-json-cte-upsert-views-matrix.test.ts",
  "obscure-htmlq-xmllint-xq-html-to-markdown-unrtf-mmdc-dom-matrix.test.ts",
  "obscure-diff-diff3-patch-apply-patch-cmp-sed-awk-merge-matrix.test.ts",
  "obscure-diff-diff3-patch-apply-patch-cmp-wdiff-matrix.test.ts",
  "obscure-jq-yq-recursive-reduce-foreach-regex-paths-env-matrix.test.ts",
  "obscure-rg-grep-find-fd-xargs-readlink-realpath-stat-tree-vfs-matrix.test.ts",
  "obscure-xan-csvkit-csvsql-csvjoin-csvgrep-csvstat-tabular-etl-matrix.test.ts",
  "obscure-coreutils-sort-join-comm-column-csplit-tsort-numfmt-bc-matrix.test.ts",
  "obscure-bash-shell-arrays-nameref-traps-getopts-process-subst-fd-matrix.test.ts",
  "obscure-polyglot-etl-log-forensics-sql-jq-yq-xan-archive-matrix.test.ts",
  "obscure-sed-awk-perl-style-text-state-machines-branching-buffers-matrix.test.ts",
  "obscure-tar-zip-gzip-zstd-xz-bzip2-base64-xxd-od-dd-hashes-matrix.test.ts",
  "obscure-pdf-office-image-audio-video-exif-qr-ocr-pipeline-matrix.test.ts",
  "obscure-sqlite3-recursive-graph-window-frames-json-each-triggers-matrix.test.ts",
  "obscure-jq-yq-xq-xmllint-htmlq-toml-xml-yaml-csv-json-matrix.test.ts",
  "obscure-xan-csvkit-tabular-join-groupby-pivot-flatmap-bins-matrix.test.ts",
  "obscure-bash-shell-grammar-extglob-brace-arith-traps-coproc-fd-matrix.test.ts",
  "obscure-rg-grep-find-fd-xargs-diff-diff3-patch-apply-patch-vfs-matrix.test.ts",
  "obscure-coreutils-sort-join-comm-cut-paste-tr-nl-column-bc-dc-matrix.test.ts",
  "obscure-polyglot-cloud-secops-k8s-sbom-sql-jq-yq-xan-pdf-matrix.test.ts",
  "obscure-awk-sed-perl-regex-backrefs-ranges-getline-arrays-matrix.test.ts",
  "obscure-sqlite3-cte-window-upsert-triggers-fk-json-views-pragmas-matrix.test.ts",
  "obscure-jq-yq-xq-xmllint-htmlq-xan-csvkit-structured-etl-matrix.test.ts",
  "obscure-bash-shell-expansion-nameref-arrays-traps-getopts-subshell-matrix.test.ts",
  "obscure-media-pdf-image-video-audio-office-diagram-exif-pipeline-matrix.test.ts",
  "obscure-archive-crypto-binary-diff-patch-find-fd-rg-coreutils-matrix.test.ts",
  "obscure-polyglot-finops-mlops-telemetry-sql-jq-yq-xan-pdf-archive-matrix.test.ts",
  "obscure-jq-yq-xq-xmllint-htmlq-xan-csvkit-sqlite3-deep-edge-matrix.test.ts",
  "obscure-awk-sed-rg-grep-find-fd-diff-patch-coreutils-edge-matrix.test.ts",
  "obscure-bash-shell-expansion-traps-arrays-arithmetic-redirection-edge-matrix.test.ts",
  "obscure-media-pdf-image-video-audio-office-diagram-archive-crypto-edge-matrix.test.ts",
  "obscure-polyglot-supply-chain-sbom-cve-sql-jq-yq-xan-pdf-archive-matrix.test.ts",
  "obscure-sqlite3-json-window-cte-triggers-upsert-views-csvkit-xan-matrix.test.ts",
  "obscure-awk-sed-rg-grep-find-fd-xargs-diff-patch-coreutils-refactor-matrix.test.ts",
  "obscure-jq-yq-xq-xmllint-htmlq-structured-transforms-reducers-xpath-matrix.test.ts",
  "obscure-bash-shell-subshell-pipefail-errexit-traps-arrays-glob-fd-matrix.test.ts",
  "obscure-polyglot-milestone-100-full-stack-etl-sql-jq-yq-xan-pdf-media-archive-matrix.test.ts",
  "obscure-xan-csvkit-sqlite3-jq-yq-tabular-analytics-pivot-window-matrix.test.ts",
  "obscure-awk-sed-rg-grep-find-fd-xargs-diff-patch-coreutils-text-engine-matrix.test.ts",
  "obscure-bash-shell-expansion-nameref-arrays-traps-getopts-process-subst-edge-matrix.test.ts",
  "obscure-media-pdf-image-video-audio-office-diagram-archive-crypto-pipeline-matrix.test.ts",
  "obscure-polyglot-secops-finops-k8s-sbom-sql-jq-yq-xan-pdf-archive-matrix.test.ts",
  "obscure-sqlite3-cte-window-triggers-upsert-json-views-pragmas-deep-matrix.test.ts",
  "obscure-jq-yq-xq-xmllint-htmlq-structured-query-reducers-paths-matrix.test.ts",
  "obscure-rg-grep-find-fd-xargs-diff-patch-vfs-symlinks-perms-matrix.test.ts",
  "obscure-awk-sed-envsubst-join-bc-expr-text-math-matrix.test.ts",
  "obscure-tar-zip-gzip-zstd-xz-bzip2-openssl-xxd-binary-archive-matrix.test.ts",
  "obscure-gpg-openssl-wdiff-mdq-rgrep-crypto-markdown-diff-matrix.test.ts",
  "obscure-ssh-keygen-svgo-rsvg-diffpdf-openssl-gpg-vector-crypto-matrix.test.ts",
  "obscure-sox-soxi-qrencode-wav-dsp-qr-barcode-matrix.test.ts",
  "obscure-dot-neato-graphviz-svgo-rsvg-diffpdf-ast-matrix.test.ts",
  "obscure-less-more-pager-pdfunite-pdfseparate-pdffonts-pdfdetach-pdftocairo-matrix.test.ts",
  "obscure-pdftohtml-pdftotext-htmlq-mdq-xmllint-xq-html-to-markdown-matrix.test.ts",
  "obscure-magick-composite-montage-compare-mogrify-identify-sips-exiftool-matrix.test.ts",
  "obscure-mmdc-unrtf-soffice-libreoffice-ffmpeg-ffprobe-matrix.test.ts",
  "obscure-qpdf-pdftk-pdfinfo-pdffonts-pdfdetach-pdftoppm-pdfimages-wkhtmltopdf-matrix.test.ts",
  "obscure-csvkit-csvcut-csvgrep-csvstat-csvjson-in2csv-csvclean-csvsql-sql2csv-matrix.test.ts",
  "obscure-pandoc-ssconvert-docx-odt-epub-xlsx-ods-html-latex-rst-matrix.test.ts",
  "obscure-ast-grep-sg-caller-structural-search-rewrite-scan-matrix.test.ts",
  "obscure-alias-unalias-shopt-hash-pdfseparate-pdfunite-matrix.test.ts",
  "obscure-truncate-dos2unix-unix2dos-expand-unexpand-fold-tac-rev-strings-matrix.test.ts",
  "obscure-getconf-locale-id-uname-nproc-pathchk-mktemp-readlink-realpath-install-matrix.test.ts",
  "obscure-nl-paste-comm-seq-envsubst-printenv-basename-dirname-tee-sponge-matrix.test.ts",
  "obscure-mkdir-rmdir-rm-ln-cp-mv-chmod-stat-du-ls-matrix.test.ts",
  "obscure-cat-head-tail-wc-cut-tr-uniq-sort-join-matrix.test.ts",
  "obscure-split-csplit-fmt-pr-tsort-column-fold-expand-matrix.test.ts",
  "obscure-getopt-shuf-dd-truncate-install-dos2unix-iconv-matrix.test.ts",
  "obscure-date-cal-numfmt-factor-expr-seq-matrix.test.ts",
  "obscure-xxd-od-hexdump-base64-base32-strings-cksum-matrix.test.ts",
  "obscure-tar-zip-unzip-gzip-bzip2-xz-zstd-matrix.test.ts",
  "obscure-grep-rg-find-fd-xargs-which-search-matrix.test.ts",
  "obscure-tree-file-du-stat-ls-realpath-fs-matrix.test.ts",
  "obscure-df-cal-ncal-whoami-egrep-fgrep-rgrep-less-more-matrix.test.ts",
];

function isPureRustCaller(): boolean {
  if (process.env.SAFE_BASH_E2E_FORCE_NATIVE === "1") return true;
  const stack = new Error().stack ?? "";
  return PURE_RUST_SUITE_FILES.some((f) => stack.includes(f));
}

async function pathExists(fs: sb.FileSystem, targetPath: string): Promise<boolean> {
  try {
    if (fs.lstat) await fs.lstat(targetPath);
    else await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function parentDirectories(filePath: string): string[] {
  const normalized = sb.normalizePath(filePath);
  const parts = normalized.split("/").filter(Boolean);
  const dirs: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    dirs.push("/" + parts.slice(0, i).join("/"));
  }
  return dirs;
}

export class SafeBashE2EHarness {
  readonly fs: sb.FileSystem;
  readonly memoryFs: sb.MemoryFileSystem | undefined;
  readonly shell: sb.Shell;
  readonly recorder: BenchmarkRecorder;
  private readonly warmBeforeExec: boolean;

  private constructor(
    fs: sb.FileSystem,
    memoryFs: sb.MemoryFileSystem | undefined,
    shell: sb.Shell,
    recorder: BenchmarkRecorder,
    warmBeforeExec = false,
  ) {
    this.fs = fs;
    this.memoryFs = memoryFs;
    this.shell = shell;
    this.recorder = recorder;
    this.warmBeforeExec = warmBeforeExec;
  }

  static async create(options: E2EHarnessOptions = {}): Promise<SafeBashE2EHarness> {
    const seedIntoFs = async (fs: sb.FileSystem): Promise<void> => {
      const dirsToCreate = new Set<string>(["/tmp", "/workspace", "/home/user"]);
      if (options.cwd) dirsToCreate.add(sb.normalizePath(options.cwd));
      for (const dir of options.directories ?? []) {
        dirsToCreate.add(sb.normalizePath(dir));
      }
      for (const filePath of Object.keys(options.files ?? {})) {
        for (const dir of parentDirectories(filePath)) dirsToCreate.add(dir);
      }
      for (const linkPath of Object.keys(options.symlinks ?? {})) {
        for (const dir of parentDirectories(linkPath)) dirsToCreate.add(dir);
      }
      if (!fs.capabilities?.readOnly) {
        const sortedDirs = [...dirsToCreate].sort((a, b) => a.length - b.length);
        for (const dir of sortedDirs) {
          if (dir === "/") continue;
          if (!(await pathExists(fs, dir))) {
            await fs.mkdir(dir, { recursive: true });
          }
        }
      }
      for (const [rawPath, init] of Object.entries(options.files ?? {})) {
        const normalizedPath = sb.normalizePath(rawPath);
        if (typeof init === "string" || init instanceof Uint8Array) {
          await fs.writeFile(normalizedPath, typeof init === "string" ? utf8Encoder.encode(init) : init);
        } else {
          await fs.writeFile(normalizedPath, typeof init.content === "string" ? utf8Encoder.encode(init.content) : init.content);
          if (init.mode !== undefined && fs.chmod) {
            await fs.chmod(normalizedPath, init.mode);
          }
          if (init.mtime !== undefined && fs.utimes) {
            const ms = init.mtime.getTime();
            await fs.utimes(normalizedPath, ms, ms);
          }
        }
      }
      for (const [rawLink, target] of Object.entries(options.symlinks ?? {})) {
        const normalizedLink = sb.normalizePath(rawLink);
        if (fs.symlink) {
          await fs.symlink(target, normalizedLink);
        }
      }
    };

    const buildTsShell = (fs: sb.FileSystem, memoryFs: sb.MemoryFileSystem | undefined) => {
      const shellFs =
        options.mountDev && memoryFs
          ? sb.createMountFileSystem({
              root: memoryFs,
              mounts: { "/dev": createDeviceFileSystem() },
            })
          : fs;
      const shell = new sb.Shell({
        fs: shellFs,
        ...(options.mountDev && memoryFs ? { deviceView: "provided" as const } : {}),
        cwd: options.cwd ?? "/workspace",
        ...(options.bareShell && !options.env
          ? {}
          : {
              env: {
                HOME: "/home/user",
                USER: "e2e",
                PATH: "/usr/local/bin:/usr/bin:/bin",
                LANG: "C",
                LC_ALL: "C",
                ...options.env,
              },
            }),
        limits: options.limits,
        backgroundJobs: options.backgroundJobs,
        ...(options.shellExtensions !== false && !options.bareShell
          ? {
              extensions: [
                readExtension(),
                mapfileExtension(),
                arraysExtension(),
                jobsExtension(),
                trapExtension(),
              ],
            }
          : {}),
      });

      shell.use(sb.agentCommands());

      if (options.includeExtendedCommands !== false) {
        shell
          .use(sb.bcCommands({ replace: true }))
          .use(sb.calCommands({ replace: true }))
          .use(sb.ddCommands({ replace: true }))
          .use(sb.dfCommands({ replace: true }))
          .use(sb.envsubstCommands({ replace: true }))
          .use(sb.fdCommands({ replace: true }))
          .use(sb.getconfCommands({ replace: true }))
          .use(sb.hostnameCommands({ replace: true }))
          .use(sb.idCommands({ replace: true }))
          .use(sb.lessCommands({ replace: true }))
          .use(sb.moreCommands({ replace: true }))
          .use(sb.localeCommands({ replace: true }))
          .use(sb.nprocCommands({ replace: true }))
          .use(sb.pathchkCommands({ replace: true }))
          .use(sb.spongeCommands({ replace: true }))
          .use(sb.sqlite3Commands({ replace: true }))
          .use(sb.unameCommands({ replace: true }))
          .use(sb.whoamiCommands({ replace: true }))
          .use(sb.yesCommands({ replace: true }))
          .use(sb.yqCommands({ replace: true }))
          .use(astGrepCommands({ replace: true }))
          .use(csvcutCommands({ replace: true }))
          .use(csvgrepCommands({ replace: true }))
          .use(csvkitCommands({ replace: true, locale: { profile: "C", timezone: "UTC", formatNumber: (val, _prof, _fmt, grouping) => { const n = Number(val); const fixed = Number.isFinite(n) ? n.toFixed(3) : String(val); if (!grouping) return fixed; const [intPart, decPart] = fixed.split("."); const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ","); return decPart !== undefined ? grouped + "." + decPart : grouped; } } }))
          .use(diff3Commands({ replace: true }))
          .use(sb.wdiffCommands({ replace: true }))
          .use(sb.diffpdfCommands({ replace: true }))
          .use(sb.svgoCommands({ replace: true }))
          .use(sb.rsvgConvertCommands({ replace: true }))
          .use(sb.dotCommands({ replace: true }))
          .use(sb.neatoCommands({ replace: true }))
          .use(soxCommands({ replace: true }))
          .use(soxiCommands({ replace: true }))
          .use(qrencodeCommands({ replace: true }))
          .use(htmlqCommands({ replace: true }))
          .use(installCommands({ replace: true }))
          .use(sb.bzip2Commands({ replace: true }))
          .use(sb.sha512sumCommands({ replace: true }))
          .use(imagemagickCommands({ replace: true }))
          .use(sipsCommands({ replace: true }))
          .use(pdfimagesCommands({ replace: true }))
          .use(pdftoppmCommands({ replace: true }))
          .use(unrtfCommands({ replace: true }))
          .use(exiftoolCommands({ replace: true }))
          .use(mmdcCommands({ replace: true }))
          .use(pdfAstWkhtmltopdfCommands({ replace: true }))
          .use(pdfinfoCommands({ replace: true }))
          .use(pdftotextCommands({ replace: true }))
          .use(pdftkCommands({ replace: true }))
          .use(sb.pdfseparateCommands({ replace: true }))
          .use(sb.pdfuniteCommands({ replace: true }))
          .use(qpdfCommands({ replace: true }))
          .use(xanCommands({ replace: true }))
          .use(sofficeCommands({ replace: true }))
          .use(ffmpegCommands({ replace: true }))
          .use({
            name: "xz-commands",
            setup(host) {
              for (const xzCmd of createXzCommands()) {
                host.commands.register(xzCmd, { replace: true });
              }
            },
          });
      }

      for (const plugin of options.plugins ?? []) {
        shell.use(plugin);
      }
      return { shell, shellFs };
    };

    if (process.env.SAFE_BASH_E2E_BACKEND === "rust" && options.fs === undefined && !options.mountDev) {
      const recorder = options.benchmarkRecorder ?? new BenchmarkRecorder();
      const forceNative = isPureRustCaller() && (!options.plugins || options.plugins.length === 0);
      const rustBash = new RustWasmBash({
        cwd: options.cwd ?? "/workspace",
        limits: options.limits,
        memoryFsOptions: options.memoryFsOptions,
        forceNative,
        ShellLimitError: sb.ShellLimitError,
        companionFactory: () => {
          const mfs = new sb.MemoryFileSystem(options.memoryFsOptions);
          const { shell, shellFs } = buildTsShell(mfs, mfs);
          return { shell, fs: shellFs };
        },
        companionSeed: async (compFs) => {
          await seedIntoFs(compFs as sb.FileSystem);
        },
        env: options.bareShell && !options.env
          ? {}
          : {
              HOME: "/home/user",
              USER: "e2e",
              PATH: "/usr/local/bin:/usr/bin:/bin",
              LANG: "C",
              LC_ALL: "C",
              ...options.env,
            },
      });
      const fs = rustBash.fs as unknown as sb.FileSystem;
      const dirsToCreate = new Set<string>(["/tmp", "/workspace", "/home/user"]);
      if (options.cwd) dirsToCreate.add(sb.normalizePath(options.cwd));
      for (const dir of options.directories ?? []) {
        dirsToCreate.add(sb.normalizePath(dir));
      }
      for (const filePath of Object.keys(options.files ?? {})) {
        for (const dir of parentDirectories(filePath)) dirsToCreate.add(dir);
      }
      for (const linkPath of Object.keys(options.symlinks ?? {})) {
        for (const dir of parentDirectories(linkPath)) dirsToCreate.add(dir);
      }
      const sortedDirs = [...dirsToCreate].sort((a, b) => a.length - b.length);
      for (const dir of sortedDirs) {
        if (dir === "/") continue;
        rustBash.mkdirAll(dir);
        rustBash.chmod(dir, 0o777);
      }
      for (const [rawPath, init] of Object.entries(options.files ?? {})) {
        const normalizedPath = sb.normalizePath(rawPath);
        if (typeof init === "string" || init instanceof Uint8Array) {
          rustBash.writeFile(normalizedPath, typeof init === "string" ? utf8Encoder.encode(init) : init);
          rustBash.chmod(normalizedPath, 0o666);
        } else {
          rustBash.writeFile(normalizedPath, typeof init.content === "string" ? utf8Encoder.encode(init.content) : init.content);
          rustBash.chmod(normalizedPath, init.mode ?? 0o666);
          if (init.mtime !== undefined) {
            rustBash.setMtime(normalizedPath, init.mtime.getTime());
          }
        }
      }
      for (const [rawLink, target] of Object.entries(options.symlinks ?? {})) {
        const normalizedLink = sb.normalizePath(rawLink);
        rustBash.symlink(target, normalizedLink);
      }
      if (options.cwd && options.cwd !== "/workspace") {
        rustBash.execSync(`cd ${JSON.stringify(sb.normalizePath(options.cwd))}`);
      }
      if (options.plugins && options.plugins.length > 0) {
        (rustBash as unknown as { _getOrCreateCompanionSync(): void })._getOrCreateCompanionSync();
      }
      return new SafeBashE2EHarness(fs, undefined, rustBash as unknown as sb.Shell, recorder, false);
    }
    const memoryFs =
      options.fs === undefined
        ? new sb.MemoryFileSystem(options.memoryFsOptions)
        : undefined;
    const fs = options.fs ?? memoryFs!;
    const recorder = options.benchmarkRecorder ?? new BenchmarkRecorder();
    await seedIntoFs(fs);
    const { shell, shellFs } = buildTsShell(fs, memoryFs);
    return new SafeBashE2EHarness(shellFs, memoryFs, shell, recorder, options.warmBeforeExec ?? Boolean(options.bareShell));
  }

  async exec(
    script: string,
    options?: sb.ShellExecOptions & { label?: string; allowStderr?: boolean },
  ): Promise<E2EExecResult> {
    let shellOptions: sb.ShellExecOptions | undefined;
    if (options !== undefined) {
      const { label: _l, allowStderr: _a, ...rest } = options;
      if (Object.keys(rest).length > 0) {
        shellOptions = rest;
      }
    }
    if (this.warmBeforeExec && shellOptions === undefined) {
      await this.shell.exec("");
    }
    const { result, metrics } = await measureSingleExec(
      async () => {
        try {
          return await (shellOptions === undefined ? this.shell.exec(script) : this.shell.exec(script, shellOptions));
        } catch (err) {
          if (err && typeof err === "object" && "limit" in err && !(err instanceof sb.ShellLimitError)) {
            throw new sb.ShellLimitError((err as { limit: keyof sb.ShellLimits }).limit);
          }
          throw err;
        }
      },
      (res) => ({
        stdoutBytes: res.stdoutBytes.byteLength,
        stderrBytes: res.stderrBytes.byteLength,
      }),
    );
    this.recorder.recordExecSample(
      options?.label ?? script.slice(0, 80),
      metrics,
    );
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutBytes: result.stdoutBytes,
      stderrBytes: result.stderrBytes,
      exitCode: result.exitCode,
      metrics,
    };
  }

  async expectOk(
    script: string,
    expectedStdout?: string | RegExp,
    options?: sb.ShellExecOptions & { allowStderr?: boolean; label?: string },
  ): Promise<E2EExecResult> {
    const res = await this.exec(script, options);
    assert.equal(
      res.exitCode,
      0,
      `Expected exitCode 0 for script:\n${script}\nActual exitCode: ${res.exitCode}\nStdout:\n${res.stdout}\nStderr:\n${res.stderr}`,
    );
    if (!options?.allowStderr) {
      assert.equal(
        res.stderr,
        "",
        `Expected empty stderr for script:\n${script}\nActual stderr:\n${res.stderr}`,
      );
    }
    if (typeof expectedStdout === "string") {
      assert.equal(res.stdout, expectedStdout);
    } else if (expectedStdout instanceof RegExp) {
      assert.match(res.stdout, expectedStdout);
    }
    return res;
  }

  async expectFail(
    script: string,
    expectedExitCode?: number | readonly number[],
    stderrPattern?: string | RegExp,
    options?: sb.ShellExecOptions & { label?: string },
  ): Promise<E2EExecResult> {
    const res = await this.exec(script, options);
    if (typeof expectedExitCode === "number") {
      assert.equal(
        res.exitCode,
        expectedExitCode,
        `Expected exitCode ${expectedExitCode}, got ${res.exitCode}.\nStdout: ${res.stdout}\nStderr: ${res.stderr}`,
      );
    } else if (Array.isArray(expectedExitCode)) {
      assert.ok(
        expectedExitCode.includes(res.exitCode),
        `Expected exitCode in [${expectedExitCode.join(", ")}], got ${res.exitCode}.\nStdout: ${res.stdout}\nStderr: ${res.stderr}`,
      );
    } else {
      assert.notEqual(
        res.exitCode,
        0,
        `Expected non-zero exitCode, got 0.\nStdout: ${res.stdout}`,
      );
    }
    if (typeof stderrPattern === "string") {
      assert.ok(
        res.stderr.includes(stderrPattern),
        `Expected stderr to include ${JSON.stringify(stderrPattern)}, got:\n${res.stderr}`,
      );
    } else if (stderrPattern instanceof RegExp) {
      assert.match(res.stderr, stderrPattern);
    }
    return res;
  }

  async readText(filePath: string): Promise<string> {
    const bytes = await this.fs.readFile(sb.normalizePath(filePath));
    return utf8Decoder.decode(bytes);
  }

  async readBytes(filePath: string): Promise<Uint8Array> {
    return this.fs.readFile(sb.normalizePath(filePath));
  }

  async writeText(filePath: string, content: string): Promise<void> {
    const normalized = sb.normalizePath(filePath);
    for (const dir of parentDirectories(normalized)) {
      if (!(await pathExists(this.fs, dir))) {
        await this.fs.mkdir(dir, { recursive: true });
      }
    }
    await this.fs.writeFile(normalized, utf8Encoder.encode(content));
  }

  async writeBytes(filePath: string, content: Uint8Array): Promise<void> {
    const normalized = sb.normalizePath(filePath);
    for (const dir of parentDirectories(normalized)) {
      if (!(await pathExists(this.fs, dir))) {
        await this.fs.mkdir(dir, { recursive: true });
      }
    }
    await this.fs.writeFile(normalized, content);
  }

  async exists(filePath: string): Promise<boolean> {
    return pathExists(this.fs, sb.normalizePath(filePath));
  }

  async stat(filePath: string): Promise<sb.FileStat> {
    return this.fs.stat(sb.normalizePath(filePath));
  }

  async lstat(filePath: string): Promise<sb.FileStat> {
    return this.fs.lstat
      ? this.fs.lstat(sb.normalizePath(filePath))
      : this.fs.stat(sb.normalizePath(filePath));
  }

  async snapshotTree(
    rootDir = "/workspace",
  ): Promise<Record<string, TreeSnapshotEntry>> {
    const normalizedRoot = sb.normalizePath(rootDir);
    const out: Record<string, TreeSnapshotEntry> = {};

    const walk = async (currentPath: string): Promise<void> => {
      const rawEntries = await this.fs.readdir(currentPath);
      const entries = rawEntries
        .map((entry) => (typeof entry === "string" ? entry : entry.name))
        .sort();
      for (const name of entries) {
        const fullPath =
          currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
        const relPath = fullPath.startsWith(normalizedRoot + "/")
          ? fullPath.slice(normalizedRoot.length + 1)
          : fullPath;
        const st = await this.lstat(fullPath);
        const anySt = st as sb.FileStat & {
          readonly isSymbolicLink?: boolean;
          readonly isDirectory?: boolean;
          readonly isFile?: boolean;
        };
        if (st.type === "symlink" || anySt.isSymbolicLink) {
          const target = this.fs.readlink
            ? await this.fs.readlink(fullPath)
            : "";
          out[relPath] = {
            kind: "symlink",
            size: st.size,
            mode: st.mode & 0o777,
            target,
          };
        } else if (st.type === "directory" || anySt.isDirectory) {
          out[relPath] = {
            kind: "directory",
            size: 0,
            mode: st.mode & 0o777,
          };
          await walk(fullPath);
        } else if (st.type === "file" || anySt.isFile) {
          const bytes = await this.fs.readFile(fullPath);
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          const text =
            bytes.byteLength <= 4096 && !bytes.includes(0)
              ? utf8Decoder.decode(bytes)
              : undefined;
          out[relPath] = {
            kind: "file",
            size: bytes.byteLength,
            mode: st.mode & 0o777,
            sha256,
            ...(text !== undefined ? { text } : {}),
          };
        }
      }
    };

    if (await pathExists(this.fs, normalizedRoot)) {
      await walk(normalizedRoot);
    }
    return out;
  }

  async dispose(): Promise<void> {
    await this.shell.dispose();
  }
}

export async function withE2EHarness<T>(
  optionsOrFn: E2EHarnessOptions | ((harness: SafeBashE2EHarness) => Promise<T>),
  maybeFn?: (harness: SafeBashE2EHarness) => Promise<T>,
): Promise<T> {
  const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn!;
  const harness = await SafeBashE2EHarness.create(options);
  try {
    return await fn(harness);
  } finally {
    await harness.dispose();
  }
}

export async function seedFilesOnFs(
  fs: sb.FileSystem,
  files: Readonly<Record<string, E2EFileInit>>,
): Promise<void> {
  const dirs = new Set<string>();
  for (const filePath of Object.keys(files)) {
    for (const dir of parentDirectories(filePath)) dirs.add(dir);
  }
  const sortedDirs = [...dirs].sort((a, b) => a.length - b.length);
  for (const dir of sortedDirs) {
    if (dir === "/") continue;
    if (!(await pathExists(fs, dir))) {
      await fs.mkdir(dir, { recursive: true });
    }
  }
  for (const [rawPath, init] of Object.entries(files)) {
    const normalizedPath = sb.normalizePath(rawPath);
    if (typeof init === "string" || init instanceof Uint8Array) {
      await fs.writeFile(
        normalizedPath,
        typeof init === "string" ? utf8Encoder.encode(init) : init,
      );
    } else {
      await fs.writeFile(
        normalizedPath,
        typeof init.content === "string" ? utf8Encoder.encode(init.content) : init.content,
      );
      if (init.mode !== undefined && fs.chmod) {
        await fs.chmod(normalizedPath, init.mode);
      }
      if (init.mtime !== undefined && fs.utimes) {
        const ms = init.mtime.getTime();
        await fs.utimes(normalizedPath, ms, ms);
      }
    }
  }
}

export async function snapshotFsTree(
  fs: sb.FileSystem,
  rootDir = "/workspace",
): Promise<Record<string, TreeSnapshotEntry>> {
  const h = await SafeBashE2EHarness.create({ fs, cwd: rootDir });
  try {
    return await h.snapshotTree(rootDir);
  } finally {
    await h.dispose();
  }
}
