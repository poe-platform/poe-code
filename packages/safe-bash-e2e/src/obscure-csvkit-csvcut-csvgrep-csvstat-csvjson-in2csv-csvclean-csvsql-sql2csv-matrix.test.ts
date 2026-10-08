import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure csvkit (csvcut, csvgrep, csvstat, csvjson, in2csv, csvformat, csvlook, csvclean, csvstack, csvjoin, csvsort, csvsql, sql2csv) matrix", () => {
  it("1. csvcut -n/--names, --zero, -n -H conflict, combined -c and -C, -x, -l, -K, -q, -S, and --add-bom", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > raw.csv <<'CSV'
# comment preamble line 1
# comment preamble line 2
id, name, 'dept', 'note'
1, 'Alice', 'eng', 'ok'
, '', '', ''
2, 'Bob', 'sales', 'hi'
CSV

csvcut -K 2 -S -q "'" -n raw.csv > names1.txt
grep -q "^  1: id$" names1.txt
grep -q "^  2: name$" names1.txt
grep -q "^  3: dept$" names1.txt

csvcut -K 2 -S -q "'" --zero -n raw.csv > names0.txt
grep -q "^  0: id$" names0.txt
grep -q "^  3: note$" names0.txt

set +e
csvcut -n -H raw.csv 2>err.txt
ec=$?
set -e
test "$ec" -ne 0
grep -qi "no-header-row" err.txt

csvcut -K 2 -S -q "'" -c 1-3 -C 2 -x -l raw.csv > cut.csv
cat > expected_cut.csv <<'CSV'
line_number,id,dept
1,1,eng
2,2,sales
CSV
diff -u expected_cut.csv cut.csv

csvcut -K 2 -S -q "'" -c id --add-bom raw.csv > bom.csv
head -c 3 bom.csv | xxd -p | grep -q "^efbbbf$"
echo "OK_CSVCUT"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVCUT/);
    } finally {
      await h.dispose();
    }
  });

  it("2. csvgrep -f matchfile, multi-column ALL vs -a/--any-match, -i invert, -l linenumbers, and -H -l headers", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > items.csv <<'CSV'
code,primary_tag,secondary_tag,qty
A1,alpha,beta,10
A2,alpha,gamma,20
A3,delta,alpha,30
A4,omega,zeta,40
CSV

# Multi-column default requires ALL selected columns to match
csvgrep -c primary_tag,secondary_tag -r "^(alpha|beta)$" items.csv > all_match.csv
cat > expected_all.csv <<'CSV'
code,primary_tag,secondary_tag,qty
A1,alpha,beta,10
CSV
diff -u expected_all.csv all_match.csv

# With -a / --any-match, matches if ANY selected column matches
csvgrep -c primary_tag,secondary_tag -a -m alpha items.csv > any_match.csv
cat > expected_any.csv <<'CSV'
code,primary_tag,secondary_tag,qty
A1,alpha,beta,10
A2,alpha,gamma,20
A3,delta,alpha,30
CSV
diff -u expected_any.csv any_match.csv

# Matchfile with -f and -i invert and -l line_numbers
cat > patterns.txt <<'TXT'
A1
A3
TXT
csvgrep -c 1 -f patterns.txt -i -l items.csv > inv_match.csv
cat > expected_inv.csv <<'CSV'
line_numbers,code,primary_tag,secondary_tag,qty
2,A2,alpha,gamma,20
4,A4,omega,zeta,40
CSV
diff -u expected_inv.csv inv_match.csv

# -H and -l together generate default a,b,c,d,e headers
tail -n +2 items.csv | csvgrep -H -l -c 1 -m A2 > nohdr_match.csv
cat > expected_nohdr.csv <<'CSV'
a,b,c,d,e
2,A2,alpha,gamma,20
CSV
diff -u expected_nohdr.csv nohdr_match.csv
echo "OK_CSVGREP"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVGREP/);
    } finally {
      await h.dispose();
    }
  });

  it("3. csvstat --count, single-stat flags, --freq/--freq-count, --zero, and -I/--no-inference", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > metrics.csv <<'CSV'
tag,val,flag
x,10.5,true
x,20.25,false
y,30.0,true
z,,true
CSV

cnt=$(csvstat --count metrics.csv)
echo "$cnt" | grep -q "4"

t_out=$(csvstat --type metrics.csv)
echo "$t_out" | grep -q "1. tag: Text"
echo "$t_out" | grep -q "2. val: Number"
echo "$t_out" | grep -q "3. flag: Boolean"

t_noinf=$(csvstat -I --type metrics.csv)
echo "$t_noinf" | grep -q "2. val: Text"
echo "$t_noinf" | grep -q "3. flag: Text"

sum_val=$(csvstat -c 1 --zero --sum metrics.csv)
test "$sum_val" = "60.75"

mp_val=$(csvstat -c val --max-precision metrics.csv)
test "$mp_val" = "2"

null_val=$(csvstat -c val --nulls metrics.csv)
test "$null_val" = "True"

nonnull_val=$(csvstat -c val --non-nulls metrics.csv)
test "$nonnull_val" = "3"

freq_tag=$(csvstat -c tag --freq --freq-count 1 metrics.csv)
test "$freq_tag" = '{ "x": 2 }'
echo "OK_CSVSTAT_FLAGS"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVSTAT_FLAGS/);
    } finally {
      await h.dispose();
    }
  });

  it("4. csvstat --csv and csvstat --json -i 2 structured output parity", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > stats.csv <<'CSV'
name,score
alice,10
bob,20
alice,30
CSV

csvstat --csv stats.csv > stats_out.csv
head -n 1 stats_out.csv | grep -q "^column_id,column_name,type,nulls,nonnulls,unique,min,max,sum,mean,median,stdev,len,maxprecision,freq$"
grep -q "^1,name,Text,False,3,2,,,,,,,5,," stats_out.csv
grep -q "^2,score,Number,False,3,3,10,30,60,20,20,10,,0," stats_out.csv

csvstat --json -i 2 stats.csv > stats_out.json
jq -e 'length == 2 and .[0].column_name == "name" and .[1].sum == 60 and .[1].stdev == 10' stats_out.json >/dev/null
echo "OK_CSVSTAT_STRUCTURED"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVSTAT_STRUCTURED/);
    } finally {
      await h.dispose();
    }
  });

  it("5. csvjson -k/--key, --stream, --no-leading-zeroes, --blanks, --null-value, and -I", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > codes.csv <<'CSV'
id,zip,amount,empty_col,sentinel
r1,007,42,,N/A
r2,089,15.5,,ok
CSV

csvjson --no-leading-zeroes --blanks --null-value N/A -k id -i 2 codes.csv > keyed.json
jq -e '.r1.zip == "007" and .r1.amount == 42 and .r1.empty_col == "" and .r1.sentinel == null' keyed.json >/dev/null
jq -e '.r2.zip == "089" and .r2.amount == 15.5 and .r2.sentinel == "ok"' keyed.json >/dev/null

csvjson --stream -I codes.csv > stream.ndjson
wc -l < stream.ndjson | tr -d ' ' | grep -q "^2$"
head -n 1 stream.ndjson | jq -e '.zip == "007" and .amount == "42" and .empty_col == null' >/dev/null
echo "OK_CSVJSON_OPTIONS"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVJSON_OPTIONS/);
    } finally {
      await h.dispose();
    }
  });

  it("6. csvjson --lat/--lon GeoJSON FeatureCollection, --crs, --no-bbox, -k id, and --stream", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > places.csv <<'CSV'
id,city,lat,lon,kind
p1,Austin,30.2672,-97.7431,Point
p2,Dallas,32.7767,-96.7970,Point
CSV

csvjson --lat lat --lon lon -k id --type kind --crs EPSG:4326 places.csv > geo.json
jq -e '.type == "FeatureCollection" and .crs.properties.name == "EPSG:4326" and (.bbox | length == 4) and (.features | length == 2)' geo.json >/dev/null
jq -e '.features[0].id == "p1" and .features[0].geometry.coordinates[0] == -97.7431 and .features[0].geometry.coordinates[1] == 30.2672 and .features[0].properties.city == "Austin"' geo.json >/dev/null

csvjson --lat lat --lon lon --no-bbox places.csv > geo_nobbox.json
jq -e '.bbox == null' geo_nobbox.json >/dev/null

csvjson --lat lat --lon lon --stream places.csv > geo.ndjson
wc -l < geo.ndjson | tr -d ' ' | grep -q "^2$"
head -n 1 geo.ndjson | jq -e '.type == "Feature" and .geometry.type == "Point"' >/dev/null
echo "OK_CSVJSON_GEOJSON"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVJSON_GEOJSON/);
    } finally {
      await h.dispose();
    }
  });

  it("7. in2csv -f fixed with 1-based and 0-based schemas and -K skip-lines", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > schema1.csv <<'CSV'
column,start,length
id,1,3
name,4,5
score,9,4
CSV
cat > fixed.txt <<'TXT'
# skip me
001Alice  95
002Bob   100
TXT

in2csv -K 1 -f fixed -s schema1.csv fixed.txt > out1.csv
cat > expected1.csv <<'CSV'
id,name,score
001,Alice,95
002,Bob,100
CSV
diff -u expected1.csv out1.csv

cat > schema0.csv <<'CSV'
column,start,length
id,0,3
name,3,5
score,8,4
CSV
in2csv -K 1 -f fixed -s schema0.csv fixed.txt > out0.csv
diff -u expected1.csv out0.csv
echo "OK_IN2CSV_FIXED"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_IN2CSV_FIXED/);
    } finally {
      await h.dispose();
    }
  });

  it("8. in2csv -f geojson FeatureCollection extraction with geometry, properties, and coordinates", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > map.geojson <<'JSON'
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "f1",
      "properties": { "name": "HQ", "floors": 12 },
      "geometry": { "type": "Point", "coordinates": [-122.4194, 37.7749] }
    },
    {
      "type": "Feature",
      "id": "f2",
      "properties": { "name": "Annex", "floors": 4 },
      "geometry": { "type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 1], [0, 0]]] }
    }
  ]
}
JSON

in2csv -f geojson map.geojson > geo_out.csv
head -n 1 geo_out.csv | grep -q "^id,name,floors,geojson,type,longitude,latitude$"
grep -q '^f1,HQ,12,"{""type"": ""Point"", ""coordinates"": \[-122.4194, 37.7749\]}",Point,-122.4194,37.7749$' geo_out.csv
grep -q '^f2,Annex,4,.*,Polygon,,$' geo_out.csv
echo "OK_IN2CSV_GEOJSON"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_IN2CSV_GEOJSON/);
    } finally {
      await h.dispose();
    }
  });

  it("9. in2csv -f json -k key, ndjson heterogeneous keys, and gzipped input decompression", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > payload.json <<'JSON'
{
  "records": [
    {"id": "01", "name": "alpha"},
    {"id": "02", "name": "beta", "extra": "yes"}
  ]
}
JSON
gzip -c payload.json > payload.json.gz

in2csv -f json -k records -I payload.json.gz > from_gz.csv
cat > expected_gz.csv <<'CSV'
id,name,extra
01,alpha,
02,beta,yes
CSV
diff -u expected_gz.csv from_gz.csv

cat > stream.ndjson <<'NDJSON'
{"a": 10, "b": "x"}
{"b": "y", "c": 20}
NDJSON
in2csv -f ndjson stream.ndjson > from_ndjson.csv
cat > expected_ndjson.csv <<'CSV'
a,b,c
10,x,
,y,20
CSV
diff -u expected_ndjson.csv from_ndjson.csv
echo "OK_IN2CSV_JSON_GZ"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_IN2CSV_JSON_GZ/);
    } finally {
      await h.dispose();
    }
  });

  it("10. in2csv -f xlsx workbook sheet listing (-n/--names) and --sheet conversion", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
mkdir -p xlsx_dir/_rels xlsx_dir/xl/_rels xlsx_dir/xl/worksheets
cat > 'xlsx_dir/[Content_Types].xml' <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>
XML

cat > xlsx_dir/_rels/.rels <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
XML

cat > xlsx_dir/xl/workbook.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Summary" sheetId="1" r:id="rId1"/>
    <sheet name="Details" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>
XML

cat > xlsx_dir/xl/_rels/workbook.xml.rels <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>
XML

cat > xlsx_dir/xl/sharedStrings.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
  <si><t>region</t></si>
  <si><t>total</t></si>
  <si><t>north</t></si>
  <si><t>south</t></si>
</sst>
XML

cat > xlsx_dir/xl/worksheets/sheet1.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>150</v></c></row>
  </sheetData>
</worksheet>
XML

cat > xlsx_dir/xl/worksheets/sheet2.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>note</t></is></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="C2" t="inlineStr"><is><t>verified</t></is></c></row>
  </sheetData>
</worksheet>
XML

(cd xlsx_dir && zip -0 -q -r ../book.xlsx '[Content_Types].xml' _rels xl)

in2csv -n book.xlsx > sheets.txt
cat > expected_sheets.txt <<'TXT'
Summary
Details
TXT
diff -u expected_sheets.txt sheets.txt

in2csv --sheet Details book.xlsx > details.csv
cat > expected_details.csv <<'CSV'
region,total,note
south,,verified
CSV
diff -u expected_details.csv details.csv
echo "OK_IN2CSV_XLSX"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_IN2CSV_XLSX/);
    } finally {
      await h.dispose();
    }
  });

  it("11. csvformat -A/--out-asv, -U quoting modes (0,1,2,3), -B/-P escapechar, -M terminator, and -E/--skip-header", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > fmt.csv <<'CSV'
name,score,comment
alice,10,"hello, world"
bob,20,say "hi"
CSV

# -U 1 quotes all fields
csvformat -U 1 -E fmt.csv > q_all.csv
cat > expected_qall.csv <<'CSV'
"alice","10","hello, world"
"bob","20","say ""hi"""
CSV
diff -u expected_qall.csv q_all.csv

# -U 2 quotes non-numeric fields only
csvformat -U 2 -E fmt.csv > q_nonnum.csv
cat > expected_qnonnum.csv <<'CSV'
"alice",10,"hello, world"
"bob",20,"say ""hi"""
CSV
diff -u expected_qnonnum.csv q_nonnum.csv

# -U 3 quotes none and escapes delimiter with -P \
csvformat -U 3 -P '\' -E fmt.csv > q_none.csv
grep -q '^alice,10,hello\\, world$' q_none.csv

# -A outputs ASCII unit separator (0x1f) and record separator (0x1e)
csvformat -A -E fmt.csv | xxd -p | tr -d '\n' | grep -q "616c6963651f31301f"
echo "OK_CSVFORMAT"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVFORMAT/);
    } finally {
      await h.dispose();
    }
  });

  it("12. csvlook type-aware alignment, -I left alignment, --max-rows, --max-columns, --max-column-width, and -l", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > look.csv <<'CSV'
title,count,extra
superlongtitlevalue,5,alpha
short,100,beta
third,2,gamma
CSV

csvlook --max-rows 2 --max-columns 2 --max-column-width 10 look.csv > table.txt
cat > expected_table.txt <<'TXT'
| title      | count | ... |
| ---------- | ----- | --- |
| superlo... |     5 | ... |
| short      |   100 | ... |
TXT
diff -u expected_table.txt table.txt

csvlook -I -l --max-rows 1 look.csv > table_noinf.txt
head -n 1 table_noinf.txt | grep -q "^| line_numbers | title"
echo "OK_CSVLOOK"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVLOOK/);
    } finally {
      await h.dispose();
    }
  });

  it("13. csvclean --length-mismatch, --empty-columns, --omit-error-rows, --label, --header-normalize-space, --join-short-rows, and --fill-short-rows", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > dirty.csv <<'CSV'
  first   name ,score,
alice,10,
bob,20
charlie,30,,50
CSV

set +e
csvclean -a --omit-error-rows --label BAD --header-normalize-space dirty.csv > clean.csv 2> errors.csv
ec=$?
set -e
test "$ec" -eq 1

cat > expected_clean.csv <<'CSV'
first name,score,
alice,10,
CSV
diff -u expected_clean.csv clean.csv

head -n 1 errors.csv | grep -q "^label,line_number,msg,first name,score,$"
grep -q "Expected 3 columns, found 2 columns" errors.csv
grep -q "Expected 3 columns, found 4 columns" errors.csv
grep -q "Empty columns named ''! Try: csvcut -C 3" errors.csv

cat > split_rows.csv <<'CSV'
id,full_name,dept
1,Alice
Smith,Eng
2,Bob,Sales
CSV
csvclean --join-short-rows --omit-error-rows --separator " " split_rows.csv > joined.csv
cat > expected_joined.csv <<'CSV'
id,full_name,dept
1,Alice Smith,Eng
2,Bob,Sales
CSV
diff -u expected_joined.csv joined.csv

cat > short.csv <<'CSV'
id,full_name
1,Alice
2
3,Bob
CSV

csvclean --fill-short-rows --fillvalue MISSING short.csv > filled.csv
cat > expected_filled.csv <<'CSV'
id,full_name
1,Alice
2,MISSING
3,Bob
CSV
diff -u expected_filled.csv filled.csv
echo "OK_CSVCLEAN"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVCLEAN/);
    } finally {
      await h.dispose();
    }
  });

  it("14. csvstack -g/--groups, -n/--group-name, --filenames, heterogeneous headers, and -H", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > jan.csv <<'CSV'
id,rev
1,100
CSV
cat > feb.csv <<'CSV'
id,cost,rev
2,40,200
CSV

csvstack -g 2025-01,2025-02 -n period jan.csv feb.csv > stacked.csv
cat > expected_stacked.csv <<'CSV'
period,id,rev,cost
2025-01,1,100,
2025-02,2,200,40
CSV
diff -u expected_stacked.csv stacked.csv

csvstack --filenames jan.csv feb.csv > by_file.csv
head -n 1 by_file.csv | grep -q "^group,id,rev,cost$"
grep -q "^jan.csv,1,100,$" by_file.csv
grep -q "^feb.csv,2,200,40$" by_file.csv
echo "OK_CSVSTACK"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVSTACK/);
    } finally {
      await h.dispose();
    }
  });

  it("15. csvjoin sequential positional join, --left, --right, --outer, duplicate column suffixing, and numeric key inference vs -I", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > left.csv <<'CSV'
id,name
1,Alice
2,Bob
CSV
cat > right.csv <<'CSV'
id,name,role
1.0,Alice_R,admin
3,Charlie_R,guest
CSV

# With type inference (default), 1 matches 1.0 and duplicate 'name' becomes 'name2'
csvjoin -c id left.csv right.csv > inner_inf.csv
cat > expected_inner_inf.csv <<'CSV'
id,name,name2,role
1,Alice,Alice_R,admin
CSV
diff -u expected_inner_inf.csv inner_inf.csv

# With -I (no inference), "1" does not match "1.0"
csvjoin -I -c id left.csv right.csv > inner_noinf.csv
wc -l < inner_noinf.csv | tr -d ' ' | grep -q "^1$"

# --right join reverses tables and performs left join from right table perspective
csvjoin --right -c id left.csv right.csv > right_join.csv
cat > expected_right.csv <<'CSV'
id,name,role,name2
1.0,Alice_R,admin,Alice
3,Charlie_R,guest,
CSV
diff -u expected_right.csv right_join.csv

# Positional join without -c merges rows by index
csvjoin left.csv right.csv > pos_join.csv
cat > expected_pos.csv <<'CSV'
id,name,id2,name2,role
1,Alice,1.0,Alice_R,admin
2,Bob,3,Charlie_R,guest
CSV
diff -u expected_pos.csv pos_join.csv
echo "OK_CSVJOIN"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVJOIN/);
    } finally {
      await h.dispose();
    }
  });

  it("16. csvsort -n/--names, multi-column -c, --zero, -r, -i/--ignore-case, -I/--no-inference, and null ordering", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > items.csv <<'CSV'
group,code,val
b,a2,10
a,A1,2
a,a1,100
b,B1,
CSV

csvsort -n items.csv > sort_names.txt
grep -q "^  1: group$" sort_names.txt

# Inferred numeric sort on column 2 (0-based --zero), nulls last
csvsort --zero -c 2 items.csv > num_sort.csv
cat > expected_num.csv <<'CSV'
group,code,val
a,A1,2
b,a2,10
a,a1,100
b,B1,
CSV
diff -u expected_num.csv num_sort.csv

# -I lexicographical sort on val ("10" < "100" < "2")
csvsort -I -c val items.csv > lex_sort.csv
cat > expected_lex.csv <<'CSV'
group,code,val
b,a2,10
a,a1,100
a,A1,2
b,B1,
CSV
diff -u expected_lex.csv lex_sort.csv
echo "OK_CSVSORT"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVSORT/);
    } finally {
      await h.dispose();
    }
  });

  it("17. csvsql DDL generation with type inference, --tables, --db-schema, --unique-constraint, and --no-constraints", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > users.csv <<'CSV'
id,username,active,balance,joined
1,alice,true,120.50,2025-01-15
2,bob,false,80.00,2025-02-20
CSV

csvsql --tables accounts --db-schema analytics --unique-constraint id,username users.csv > ddl.sql
grep -q 'CREATE TABLE analytics.accounts (' ddl.sql
grep -Eq '"?id"? DECIMAL NOT NULL' ddl.sql
grep -Eq '"?username"? VARCHAR NOT NULL' ddl.sql
grep -Eq '"?active"? BOOLEAN NOT NULL' ddl.sql
grep -Eq '"?joined"? DATE NOT NULL' ddl.sql
grep -Eq 'UNIQUE \("?id"?, "?username"?\)' ddl.sql

csvsql --no-constraints users.csv > ddl_noc.sql
if grep -q "NOT NULL" ddl_noc.sql; then
  exit 1
fi
echo "OK_CSVSQL_DDL"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVSQL_DDL/);
    } finally {
      await h.dispose();
    }
  });

  it("18. csvsql --query multi-table SQL join, SQL file query path, -I no-inference, and -l linenumbers", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > depts.csv <<'CSV'
dept_id,dept_name
10,Engineering
20,Sales
CSV
cat > emps.csv <<'CSV'
emp_id,name,dept_id,salary
1,Alice,10,150
2,Bob,10,130
3,Cara,20,110
CSV

cat > report.sql <<'SQL'
SELECT d.dept_name, COUNT(*) AS headcount, CAST(SUM(e.salary) AS INTEGER) AS total_salary
FROM depts d JOIN emps e ON d.dept_id = e.dept_id
GROUP BY d.dept_name
ORDER BY total_salary DESC
SQL

csvsql --query report.sql -l depts.csv emps.csv > query_out.csv
cat > expected_query.csv <<'CSV'
line_number,dept_name,headcount,total_salary
1,Engineering,2,280
2,Sales,1,110
CSV
diff -u expected_query.csv query_out.csv
echo "OK_CSVSQL_QUERY"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVSQL_QUERY/);
    } finally {
      await h.dispose();
    }
  });

  it("19. csvsql --db sqlite:///... --insert lifecycle and sql2csv queries with --no-create, --overwrite, and hooks", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > batch1.csv <<'CSV'
id,item,qty
1,widget,5
2,gadget,10
CSV
cat > batch2.csv <<'CSV'
id,item,qty
3,sprocket,15
CSV

csvsql -I --db sqlite:///warehouse.db --insert --tables inventory batch1.csv
csvsql -I --db sqlite:///warehouse.db --insert --no-create --tables inventory \
  --after-insert "UPDATE inventory SET qty = '30' WHERE id = '3'" batch2.csv

sql2csv --db sqlite:///warehouse.db --query "SELECT id, item, qty FROM inventory ORDER BY id" -l > inv.csv
cat > expected_inv.csv <<'CSV'
line_number,id,item,qty
1,1,widget,5
2,2,gadget,10
3,3,sprocket,30
CSV
diff -u expected_inv.csv inv.csv

# Overwrite table with batch2 only
csvsql -I --db sqlite:///warehouse.db --insert --overwrite --tables inventory batch2.csv
sql2csv --db sqlite:///warehouse.db -H --query "SELECT item, qty FROM inventory" > inv_nohdr.csv
test "$(cat inv_nohdr.csv)" = "sprocket,15"
echo "OK_CSVSQL_SQL2CSV_DB"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVSQL_SQL2CSV_DB/);
    } finally {
      await h.dispose();
    }
  });

  it("20. end-to-end csvkit pipeline: in2csv -> csvclean -> csvcut -> csvgrep -> csvjoin -> csvsort -> csvsql -> sql2csv -> csvjson", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > raw_orders.json <<'JSON'
[
  {"order_id": "101", "cust_id": "C1", "region": "us-east", "amount": 250, "status": "paid"},
  {"order_id": "102", "cust_id": "C2", "region": "us-west", "amount": 90, "status": "void"},
  {"order_id": "103", "cust_id": "C1", "region": "us-east", "amount": 150, "status": "paid"},
  {"order_id": "104", "cust_id": "C3", "region": "eu-west", "amount": 500, "status": "paid"}
]
JSON

cat > customers.csv <<'CSV'
cust_id,tier
C1,gold
C2,silver
C3,platinum
CSV

in2csv -f json raw_orders.json \
  | csvcut -c order_id,cust_id,amount,status \
  | csvgrep -c status -m paid \
  | csvcut -C status > paid_orders.csv

csvjoin -c cust_id paid_orders.csv customers.csv \
  | csvsort -c amount -r > enriched_orders.csv

csvsql --db sqlite:///pipeline.db --insert --tables orders enriched_orders.csv
sql2csv --db sqlite:///pipeline.db --query "SELECT cust_id, tier, SUM(amount) AS total FROM orders GROUP BY cust_id, tier ORDER BY total DESC" \
  | csvjson -k cust_id -i 2 > summary.json

jq -e '.C3.tier == "platinum" and .C3.total == 500 and .C1.tier == "gold" and .C1.total == 400' summary.json >/dev/null
echo "OK_CSVKIT_PIPELINE"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.match(res.stdout, /OK_CSVKIT_PIPELINE/);
    } finally {
      await h.dispose();
    }
  });
});
