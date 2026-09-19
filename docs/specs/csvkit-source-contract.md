# csvkit source compatibility contract

The behavioral authority is csvkit 2.2.0's checksum-verified PyPI source archive,
SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`,
interpreted under a named frozen dependency/runtime profile. This supplement
links the completed research audit without modifying the existing implementation,
reference profile or preliminary specification.

[feature-audit-20260917.md](../csvkit/feature-audit-20260917.md) records all fourteen
command contracts, exact parser captures, ordered source flow, errors/precedence,
format/statistic/SQL/interpreter services, documentation disagreements, provenance,
licensed excerpts, source-test dispositions and 36 native observations.
Machine-readable inventories are linked from that audit. The reference's supported
3.14.2 baseline and unsupported 3.9.6 diagnostic comparison remain separate.

Future TypeScript ESM implementation belongs in the csvkit domain workspace and
is wired through safe-bash using the original executable names and argv syntax:
csvclean, csvcut, csvformat, csvgrep, csvjoin, csvjson, csvlook, csvpy, csvsort,
csvsql, csvstack, csvstat, in2csv and sql2csv. Preserve explicit/implicit option
applicability, raw versus typed paths, source quirks and SDK/CLI parity. Product
commands may not spawn processes or fall back to Python csvkit. Filesystem,
network, database and interactive capabilities must be explicitly injected.

Source declarations, parser parity and isolated examples are different evidence
classes. Every upstream source declaration currently has a named blocker in the
supplemental census; native observations do not imply the corresponding upstream
test passed. Missing reader test archives, dynamic case collection, numerical
algorithms, workbook/DBF corpus behavior, SQL drivers/services and Python
interaction remain qualification requirements. Third-party dialect entry points
are optional named profiles, separate from shipped SQLAlchemy adapters and
installed DBAPI drivers. No full JavaScript compatibility or registration claim
is made by this research-only delivery.

QA is the manual procedure in
[csvkit-feature-audit-qa.md](../plans/csvkit-feature-audit-qa.md).
