# Presentation corpus gap acquisition evidence

Status: Two fresh downloads and structural census completed. No product tests,
visual QA, signature verification or implemented regressions.

The [manifest](corpus-manifest.json) now records 14 downloaded decks, totaling
643,143,571 bytes. This campaign added 58,099,880 bytes from two independent
publishers. The [receipt](corpus-gap-acquisition.json) records acquisition timestamps,
URLs, hashes, census, failures and budget. The earlier reverification receipt
still applies only to the original 12 files.

| New disposable file            |      Bytes | Slide roots | Chart roots | Slide CJK characters |
| ------------------------------ | ---------: | ----------: | ----------: | -------------------: |
| global-outlook-2026.pptx       |  5,191,954 |          14 |           0 |                    0 |
| data-visualization-course.pptx | 52,907,926 |          39 |           7 |                3,970 |

The [World Bank listing](https://www.worldbank.org/en/publication/global-economic-prospects)
linked the presentation; direct landing retrieval returned 403, while its public
PPTX link returned 200 without credentials. Its graph illustrations did not yield
any chart roots in this census. Visual charts are not necessarily editable charts.
Public availability does not clear every embedded asset for redistribution.

The [Tokyo City University listing](https://www.comm.tcu.ac.jp/mds-center/)
linked the visualization course. Its [terms](https://www.comm.tcu.ac.jp/mds-center/etc/TermsOfUse.html)
place course No.6 under CC BY 4.0 while reserving separate review of third-party
material. Credits remain in the disposable input; no source assets are shipped.

The course has four bar charts, one line chart, one pie chart and one scatter
chart. Each chart has an internal package relationship to an embedded workbook
and local style/color relationships. The census found 24 chart-directory XML
parts, but only seven chartSpace roots: style/color parts are not extra charts.
Eight embedding parts do not establish eight chart workbooks. Embedded workbook
contents, formulas and cache agreement were not inspected. An externalData XML
element alone does not imply a network source; relationship mode matters.

CJK counts include only DrawingML text under slide parts, excluding font-list
metadata. All MCE branches are included; neither rendered visibility nor correct
shaping is established. CRC and bounded XML parsing passed for all 356 entries
in the two new decks. Fourteen and four external relationships respectively were
inventoried without fetching their targets.

The [signed mechanics listing](https://stlab.ssi.ist.hokudai.ac.jp/~yuhyama/lecture/mechatronics/index.html)
was readable through the web reader, but the public PPTX transfer timed out at
connection admission. It is a failed attempt, not a downloaded signed fixture.
No alternate host, authentication or access-control bypass was attempted.

## Coverage and original cases

The campaign closes the absence of stored chart roots and actual CJK slide text
in the seed corpus. It does not establish complete chart-type or international
text coverage. SmartArt, Strict, signatures, modern comments, RTL and a real
hundreds-of-slides deck remain unobserved here. Audio/captions and advanced chart
families remain additional gaps from the earlier audit.

[Eight original TypeScript designs](corpus-gap-regressions.json) reduce the chart
counting and CJK observations and provide small synthetic cases for six remaining
gaps. These are concrete arrange/action/expected obligations, not executable
TypeScript tests. No publisher wording, images, fonts, XML or media is copied.
Synthetic fixtures contribute zero to download counts and must run in memory
with the cache absent when implemented.

## Accounting and contracts

The existing case ledger was checked against every source inventory pointer:
2,700 unit variants plus 973 expanded BDD examples have unique destinations.
All 2,407 API inventory identities remain in the 2,424-row target register,
including inherited members, enums, helpers, collections and returned types;
underscore prefixes grant no exclusion. Standalone legal notices are retained.
The ledger still has 167 reviewed designs, 894 provisional designs, 2,611 cases
requiring semantic review and one deferred public behavior. No source case was
removed or promoted to implemented status by this acquisition.

The [language mappings](api-language-mappings.md), [API register](public-api-map.json)
and later [command register](command-coverage.json) remain the proposed mappings.
They retain neutral model spellings, async byte admission, explicit I/O/metrics/time,
keyed versus positional lookup, tri-state properties, safe EMU rounding and bounded
owned XML views. Commands use plural resources, text replace, shared selectors,
JSON envelopes, exit statuses, schema and capabilities. Prior source/API drift
resolutions remain intact. Acquisition evidence does not resolve the remaining
semantic adaptation or whole-public-API implementation work.

The agent procedure and actual bounded acquisition profile live in
[the plan](../plans/pptx-corpus-gap-acquisition.md). Historical input hashes in older
registers remain historical snapshots; the expanded manifest does not retroactively
change their evidence dates or counts.
