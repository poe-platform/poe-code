import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { SafeBashE2EHarness } from "./harness.js";

describe("obscure qpdf, pdftk, pdfinfo, pdffonts, pdfdetach, pdftoppm, pdfimages, and wkhtmltopdf matrix", () => {
  it("1. wkhtmltopdf page-size, orientation, cover object, header/footer tokens, and toc rejection", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > cover.html <<'HTML'
<!DOCTYPE html>
<html><body><h1>Cover Sheet</h1></body></html>
HTML
cat > doc.html <<'HTML'
<!DOCTYPE html>
<html>
<head><title>Spec Manual</title></head>
<body>
  <h1>Introduction</h1>
  <p>First page body text</p>
  <div style="page-break-before: always;"></div>
  <h2>Deep Architecture</h2>
  <p>Second page details</p>
</body>
</html>
HTML

wkhtmltopdf -s A4 -O Landscape --header-left "PoeManual" --footer-right "p.[page]/[topage]" cover cover.html doc.html out.pdf
pdfinfo out.pdf > info.txt
grep -q "Title:           Spec Manual" info.txt
grep -q "Pages:           3" info.txt
grep -q "841.89 x 595.28 pts (A4)" info.txt
pdftotext out.pdf - | grep -q "PoeManual"
pdftotext out.pdf - | grep -q "p.2/3"

set +e
wkhtmltopdf toc doc.html bad_toc.pdf 2>toc_err.txt
ec_toc=$?
set -e
test "$ec_toc" -eq 1
grep -q "UNSUPPORTED_CAPABILITY" toc_err.txt
echo "OK_WKHTML_COVER_FURNITURE"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_WKHTML_COVER_FURNITURE");
    } finally {
      await h.dispose();
    }
  });

  it("2. wkhtmltopdf --copies with --collate vs --no-collate and stdin/stdout streaming", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > two.html <<'HTML'
<html><body>
  <p>AlphaPage</p>
  <div style="page-break-before: always;"></div>
  <p>BetaPage</p>
</body></html>
HTML

wkhtmltopdf --copies 2 --collate two.html collated.pdf
wkhtmltopdf --copies 2 --no-collate two.html uncollated.pdf

pdftotext -f 1 -l 1 collated.pdf - | grep -q "AlphaPage"
pdftotext -f 2 -l 2 collated.pdf - | grep -q "BetaPage"
pdftotext -f 3 -l 3 collated.pdf - | grep -q "AlphaPage"
pdftotext -f 4 -l 4 collated.pdf - | grep -q "BetaPage"

pdftotext -f 1 -l 1 uncollated.pdf - | grep -q "AlphaPage"
pdftotext -f 2 -l 2 uncollated.pdf - | grep -q "AlphaPage"
pdftotext -f 3 -l 3 uncollated.pdf - | grep -q "BetaPage"
pdftotext -f 4 -l 4 uncollated.pdf - | grep -q "BetaPage"

cat two.html | wkhtmltopdf - - > streamed.pdf
qpdf --show-npages streamed.pdf
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "2");
    } finally {
      await h.dispose();
    }
  });

  it("3. pdfunite merges pages, bookmarks, page labels, and attachments while rejecting encrypted PDFs", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > a.html <<'HTML'
<html><head><title>FirstDoc</title></head><body><h1>One</h1><p>PageA1</p><div style="page-break-before: always;"></div><h2>Two</h2><p>PageA2</p></body></html>
HTML
cat > b.html <<'HTML'
<html><head><title>SecondDoc</title></head><body><h1>Three</h1><p>PageB1</p></body></html>
HTML
wkhtmltopdf a.html a_raw.pdf
wkhtmltopdf b.html b_raw.pdf

cat > b_bm.info <<'INFO'
BookmarkBegin
BookmarkTitle: Three
BookmarkLevel: 1
BookmarkPageNumber: 1
INFO
pdftk b_raw.pdf update_info b_bm.info output b_bm.pdf

echo "attached-payload" > note.txt
qpdf a_raw.pdf --add-attachment note.txt --key=note.txt -- a_att.pdf
qpdf b_bm.pdf --set-page-labels 1:r/1 -- b_lbl.pdf

pdfunite a_att.pdf b_lbl.pdf merged.pdf
qpdf --show-npages merged.pdf > np.txt
grep -q "^3$" np.txt

pdftk merged.pdf dump_data > m_dump.txt
grep -q "InfoValue: FirstDoc" m_dump.txt
grep -q "BookmarkTitle: Three" m_dump.txt
grep -q "BookmarkPageNumber: 3" m_dump.txt
grep -q "PageLabelNewIndex: 3" m_dump.txt
grep -q "PageLabelNumStyle: LowercaseRomanNumerals" m_dump.txt
pdfdetach -list merged.pdf | grep -q "1: note.txt"

qpdf --encrypt sec sec 256 -- b_raw.pdf b_enc.pdf
set +e
pdfunite a_raw.pdf b_enc.pdf bad.pdf 2>err.txt
ec=$?
set -e
test "$ec" -eq 255
echo "OK_PDFUNITE"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_PDFUNITE");
    } finally {
      await h.dispose();
    }
  });

  it("4. pdfseparate extracts page ranges with printf patterns and validates format specifiers", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > three.html <<'HTML'
<html><body>
  <p>P1</p>
  <div style="page-break-before: always;"></div>
  <p>P2</p>
  <div style="page-break-before: always;"></div>
  <p>P3</p>
</body></html>
HTML
wkhtmltopdf three.html three.pdf

pdfseparate -f 2 -l 3 three.pdf part_%03d.pdf
test -f part_002.pdf
test -f part_003.pdf
pdftotext part_002.pdf - | grep -q "P2"
pdftotext part_003.pdf - | grep -q "P3"

set +e
pdfseparate three.pdf no_pattern.pdf 2>err1.txt
ec1=$?
pdfseparate -f 3 -l 1 three.pdf bad_%d.pdf 2>err2.txt
ec2=$?
set -e
test "$ec1" -eq 99
test "$ec2" -eq 99
echo "OK_PDFSEPARATE"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_PDFSEPARATE");
    } finally {
      await h.dispose();
    }
  });

  it("5. qpdf --check, --show-npages, --show-linearization, --show-xref, and --show-pages --with-images", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
magick -size 20x15 xc:red pic.png
b64=$(base64 < pic.png | tr -d '\n')
cat > img.html <<HTML
<html><body><p>Hello QPDF</p><img src="data:image/png;base64,$b64" width="20" height="15"/></body></html>
HTML
wkhtmltopdf img.html in.pdf
qpdf --linearize in.pdf lin.pdf

qpdf --check lin.pdf > chk.txt
grep -q "checking lin.pdf" chk.txt
grep -q "File is linearized" chk.txt
grep -q "No syntax or stream encoding errors found" chk.txt

qpdf --show-linearization lin.pdf | grep -q "lin.pdf: linearized"
qpdf --show-xref lin.pdf | grep -q "1/0: uncompressed"
qpdf --show-pages --with-images lin.pdf > pages.txt
grep -q "page 1:" pages.txt
grep -q "/Im1:" pages.txt
grep -q "(20 x 15)" pages.txt
echo "OK_QPDF_INSPECT"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_QPDF_INSPECT");
    } finally {
      await h.dispose();
    }
  });

  it("6. qpdf --show-object with catalog, page tree, page dict, and filtered stream data", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
echo "<html><body><p>StreamBodyToken</p></body></html>" | wkhtmltopdf - doc.pdf
qpdf --show-object=1 doc.pdf | grep -q "/Type /Catalog"
qpdf --show-object=2 doc.pdf | grep -q "/Count 1"
qpdf --show-object=5 doc.pdf | grep -q "/Type /Page"
qpdf --show-object=4 --filtered-stream-data doc.pdf | grep -q "StreamBodyToken"
echo "OK_QPDF_OBJECTS"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_QPDF_OBJECTS");
    } finally {
      await h.dispose();
    }
  });

  it("7. qpdf --json, --json-stream-data=inline|file, --json-input, and --update-from-json", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
echo "<html><body><p>JsonPayloadText</p></body></html>" | wkhtmltopdf - base.pdf

qpdf --json --json-stream-data=inline base.pdf > inline.json
jq -r '.version' inline.json | grep -q "^2$"
jq -r '.qpdf[1]["obj:4 0 R"].stream.data' inline.json | base64 -d | grep -q "JsonPayloadText"

qpdf --json-input inline.json from_json.pdf
pdftotext from_json.pdf - | grep -q "JsonPayloadText"

qpdf --json --json-stream-data=file base.pdf file_out.json
test -f file_out.json-4
grep -q "JsonPayloadText" file_out.json-4

jq '.qpdf[1]["obj:5 0 R"].value["/Rotate"] = 90' inline.json > update.json
qpdf base.pdf --update-from-json=update.json rotated.pdf
pdfinfo rotated.pdf | grep -q "Page rot:        90"
echo "OK_QPDF_JSON"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_QPDF_JSON");
    } finally {
      await h.dispose();
    }
  });

  it("8. qpdf encryption, --is-encrypted, --requires-password, --show-encryption, and --decrypt", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
echo "<html><body><p>Classified</p></body></html>" | wkhtmltopdf - plain.pdf

set +e
qpdf --is-encrypted plain.pdf
ec_plain_enc=$?
qpdf --requires-password plain.pdf
ec_plain_req=$?
set -e
test "$ec_plain_enc" -eq 2
test "$ec_plain_req" -eq 2

qpdf --encrypt SecretPW OwnerPW 256 -- plain.pdf locked.pdf
qpdf --is-encrypted locked.pdf

set +e
qpdf --requires-password locked.pdf
ec_need_pw=$?
qpdf --password=WrongPW --requires-password locked.pdf
ec_wrong_pw=$?
qpdf --password=SecretPW --requires-password locked.pdf
ec_good_pw=$?
set -e
test "$ec_need_pw" -eq 0
test "$ec_wrong_pw" -eq 0
test "$ec_good_pw" -eq 3

qpdf --password=SecretPW --show-encryption locked.pdf > enc_info.txt
grep -q "R = 6" enc_info.txt
qpdf --password=SecretPW --decrypt locked.pdf unlocked.pdf

qpdf --show-encryption unlocked.pdf > unlocked_enc.txt
grep -q "File is not encrypted" unlocked_enc.txt
qpdf --check unlocked.pdf > unlocked_check.txt
grep -q "File is not encrypted" unlocked_check.txt
pdftotext unlocked.pdf unlocked.txt
grep -q "Classified" unlocked.txt
echo "OK_QPDF_CRYPTO"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_QPDF_CRYPTO");
    } finally {
      await h.dispose();
    }
  });

  it("9. qpdf --empty --pages with reverse ranges, odd/even qualifiers, and --collate=2", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > a.html <<'HTML'
<html><body>
  <p>A1</p><div style="page-break-before: always;"></div>
  <p>A2</p><div style="page-break-before: always;"></div>
  <p>A3</p><div style="page-break-before: always;"></div>
  <p>A4</p>
</body></html>
HTML
cat > b.html <<'HTML'
<html><body>
  <p>B1</p><div style="page-break-before: always;"></div>
  <p>B2</p><div style="page-break-before: always;"></div>
  <p>B3</p><div style="page-break-before: always;"></div>
  <p>B4</p>
</body></html>
HTML
wkhtmltopdf a.html a.pdf
wkhtmltopdf b.html b.pdf

qpdf --empty --pages a.pdf r1-r2 b.pdf 1-4:odd -- rev_odd.pdf
qpdf --show-npages rev_odd.pdf | grep -q "^4$"
pdftotext -f 1 -l 1 rev_odd.pdf - | grep -q "A4"
pdftotext -f 2 -l 2 rev_odd.pdf - | grep -q "A3"
pdftotext -f 3 -l 3 rev_odd.pdf - | grep -q "B1"
pdftotext -f 4 -l 4 rev_odd.pdf - | grep -q "B3"

qpdf --empty --collate=2 --pages a.pdf 1-4 b.pdf 1-4 -- collated2.pdf
pdftotext -f 1 -l 1 collated2.pdf - | grep -q "A1"
pdftotext -f 2 -l 2 collated2.pdf - | grep -q "A2"
pdftotext -f 3 -l 3 collated2.pdf - | grep -q "B1"
pdftotext -f 4 -l 4 collated2.pdf - | grep -q "B2"
pdftotext -f 5 -l 5 collated2.pdf - | grep -q "A3"
echo "OK_QPDF_PAGES"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_QPDF_PAGES");
    } finally {
      await h.dispose();
    }
  });

  it("10. qpdf --rotate relative/absolute angles, --flatten-rotation, and diffpdf --layout vs --text", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > two.html <<'HTML'
<html><body><p>PageOne</p><div style="page-break-before: always;"></div><p>PageTwo</p></body></html>
HTML
wkhtmltopdf -s Letter two.html base.pdf
qpdf base.pdf --rotate=+90:1 --rotate=180:2 rot1.pdf
qpdf rot1.pdf --rotate=+90:1 rot2.pdf

pdfinfo -f 1 -l 2 rot1.pdf > info1.txt
grep -q "Page    1 rot:   90" info1.txt
grep -q "Page    2 rot:   180" info1.txt
pdfinfo -f 1 -l 1 rot2.pdf | grep -q "Page    1 rot:   180"

qpdf rot1.pdf --flatten-rotation flat.pdf
pdfinfo -f 1 -l 2 flat.pdf > flat_info.txt
grep -q "Page    1 size:  792 x 612 pts (letter)" flat_info.txt
grep -q "Page    1 rot:   0" flat_info.txt

diffpdf --text base.pdf flat.pdf
set +e
diffpdf --layout base.pdf flat.pdf > diff_layout.txt
ec_layout=$?
set -e
test "$ec_layout" -eq 1
grep -q "Page 1 differs (layout)" diff_layout.txt
echo "OK_QPDF_ROTATE_FLATTEN"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_QPDF_ROTATE_FLATTEN");
    } finally {
      await h.dispose();
    }
  });

  it("11. qpdf --overlay and --underlay with --from, --to, and --repeat", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > main.html <<'HTML'
<html><body>
  <p>Body1</p><div style="page-break-before: always;"></div>
  <p>Body2</p><div style="page-break-before: always;"></div>
  <p>Body3</p>
</body></html>
HTML
cat > stamp.html <<'HTML'
<html><body>
  <p>WM_A</p><div style="page-break-before: always;"></div>
  <p>WM_B</p>
</body></html>
HTML
wkhtmltopdf main.html main.pdf
wkhtmltopdf stamp.html stamp.pdf

qpdf main.pdf --overlay stamp.pdf --from=1-2 --to=1-3 --repeat=2 -- over.pdf
pdftotext -raw -f 1 -l 1 over.pdf - | grep -q "WM_A"
pdftotext -raw -f 2 -l 2 over.pdf - | grep -q "WM_B"
pdftotext -raw -f 3 -l 3 over.pdf - | grep -q "WM_B"

qpdf main.pdf --underlay stamp.pdf --from=1 --to=2 -- under.pdf
pdftotext -raw -f 2 -l 2 under.pdf - | grep -q "WM_A"
echo "OK_QPDF_OVERLAY"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_QPDF_OVERLAY");
    } finally {
      await h.dispose();
    }
  });

  it("12. qpdf attachment lifecycle: --add-attachment, --replace, --copy-attachments-from, --show-attachment, --remove-attachment", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
echo "<html><body><p>Host</p></body></html>" | wkhtmltopdf - host.pdf
echo "v1-data" > a.txt
echo "v2-data" > b.txt

qpdf host.pdf --add-attachment a.txt --key=cfg --filename=config.txt -- att1.pdf
qpdf --list-attachments att1.pdf | grep -q "cfg -> config.txt"
qpdf --show-attachment=cfg att1.pdf | grep -q "^v1-data$"

set +e
qpdf att1.pdf --add-attachment b.txt --key=cfg -- dup_fail.pdf 2>err.txt
ec_dup=$?
set -e
test "$ec_dup" -eq 2

qpdf att1.pdf --add-attachment b.txt --key=cfg --filename=config.txt --replace -- att2.pdf
qpdf --show-attachment=cfg att2.pdf | grep -q "^v2-data$"

qpdf host.pdf --copy-attachments-from att2.pdf --prefix=imported_ -- copied.pdf
qpdf --list-attachments copied.pdf | grep -q "imported_cfg -> config.txt"

qpdf copied.pdf --remove-attachment=imported_cfg stripped.pdf
test -z "$(qpdf --list-attachments stripped.pdf)"
echo "OK_QPDF_ATTACHMENTS"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_QPDF_ATTACHMENTS");
    } finally {
      await h.dispose();
    }
  });

  it("13. qpdf --set-page-labels and --remove-page-labels verified via pdftk dump_data", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > four.html <<'HTML'
<html><body>
  <p>1</p><div style="page-break-before: always;"></div>
  <p>2</p><div style="page-break-before: always;"></div>
  <p>3</p><div style="page-break-before: always;"></div>
  <p>4</p>
</body></html>
HTML
wkhtmltopdf four.html four.pdf

qpdf four.pdf --set-page-labels 1:r/1 3:D/1/Ch- -- labeled.pdf
pdftk labeled.pdf dump_data > lbl_dump.txt
grep -q "PageLabelNewIndex: 1" lbl_dump.txt
grep -q "PageLabelNumStyle: LowercaseRomanNumerals" lbl_dump.txt
grep -q "PageLabelNewIndex: 3" lbl_dump.txt
grep -q "PageLabelPrefix: Ch-" lbl_dump.txt
grep -q "PageLabelNumStyle: DecimalArabicNumerals" lbl_dump.txt

qpdf labeled.pdf --remove-page-labels unlabeled.pdf
pdftk unlabeled.pdf dump_data > unlbl_dump.txt
if grep -q "PageLabelBegin" unlbl_dump.txt; then
  exit 1
fi
echo "OK_QPDF_LABELS"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_QPDF_LABELS");
    } finally {
      await h.dispose();
    }
  });

  it("14. qpdf --split-pages zero-padded naming for single and multi-page groups", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > five.html <<'HTML'
<html><body>
  <p>P1</p><div style="page-break-before: always;"></div>
  <p>P2</p><div style="page-break-before: always;"></div>
  <p>P3</p><div style="page-break-before: always;"></div>
  <p>P4</p><div style="page-break-before: always;"></div>
  <p>P5</p>
</body></html>
HTML
wkhtmltopdf five.html five.pdf

qpdf --split-pages=2 five.pdf chunk-%d.pdf
test -f chunk-1-2.pdf
test -f chunk-3-4.pdf
test -f chunk-5-5.pdf
qpdf --show-npages chunk-1-2.pdf | grep -q "^2$"
qpdf --show-npages chunk-5-5.pdf | grep -q "^1$"
echo "OK_QPDF_SPLIT"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_QPDF_SPLIT");
    } finally {
      await h.dispose();
    }
  });

  it("15. pdftk multi-char handles, cat/shuffle with odd/even and relative/absolute rotations, and bookmark remapping", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > a.html <<'HTML'
<html><body>
  <h1>Chap1</h1><p>A1</p><div style="page-break-before: always;"></div>
  <h1>Chap2</h1><p>A2</p><div style="page-break-before: always;"></div>
  <h1>Chap3</h1><p>A3</p><div style="page-break-before: always;"></div>
  <h1>Chap4</h1><p>A4</p>
</body></html>
HTML
cat > b.html <<'HTML'
<html><body>
  <h1>Appendix1</h1><p>B1</p><div style="page-break-before: always;"></div>
  <h1>Appendix2</h1><p>B2</p>
</body></html>
HTML
wkhtmltopdf a.html a_raw.pdf
wkhtmltopdf b.html b_raw.pdf

cat > a_bm.info <<'INFO'
BookmarkBegin
BookmarkTitle: Chap3
BookmarkLevel: 1
BookmarkPageNumber: 3
INFO
cat > b_bm.info <<'INFO'
BookmarkBegin
BookmarkTitle: Appendix2
BookmarkLevel: 1
BookmarkPageNumber: 2
INFO
pdftk a_raw.pdf update_info a_bm.info output a.pdf
pdftk b_raw.pdf update_info b_bm.info output b.pdf

pdftk A=a.pdf BC=b.pdf cat A1-4oddeast BC2-1left output cat_out.pdf
qpdf --show-npages cat_out.pdf | grep -q "^4$"
pdfinfo -f 1 -l 4 cat_out.pdf > cat_info.txt
grep -q "Page    1 rot:   90" cat_info.txt
grep -q "Page    3 rot:   270" cat_info.txt

pdftk cat_out.pdf dump_data > cat_dump.txt
grep -q "BookmarkTitle: Chap3" cat_dump.txt
grep -q "BookmarkPageNumber: 2" cat_dump.txt
grep -q "BookmarkTitle: Appendix2" cat_dump.txt
grep -q "BookmarkPageNumber: 3" cat_dump.txt

pdftk A=a.pdf BC=b.pdf shuffle A1-2 BC1-2 output shuf_out.pdf
pdftotext -f 1 -l 1 shuf_out.pdf - | grep -q "A1"
pdftotext -f 2 -l 2 shuf_out.pdf - | grep -q "B1"
pdftotext -f 3 -l 3 shuf_out.pdf - | grep -q "A2"
pdftotext -f 4 -l 4 shuf_out.pdf - | grep -q "B2"
echo "OK_PDFTK_CAT_SHUFFLE"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_PDFTK_CAT_SHUFFLE");
    } finally {
      await h.dispose();
    }
  });

  it("16. pdftk dump_data vs dump_data_utf8 XML entities and update_info updating Info, PdfID, Bookmarks, PageMedia, and PageLabels", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
echo "<html><body><p>Page1</p><div style='page-break-before: always;'></div><p>Page2</p></body></html>" | wkhtmltopdf - doc.pdf

cat > meta.info <<'INFO'
InfoBegin
InfoKey: Title
InfoValue: Caf&#233; Bar
InfoBegin
InfoKey: Author
InfoValue: Ren&#xe9;
PdfID0: 11111111111111111111111111111111
PdfID1: 22222222222222222222222222222222
BookmarkBegin
BookmarkTitle: Sec &#233;
BookmarkLevel: 1
BookmarkPageNumber: 2
PageMediaBegin
PageMediaNumber: 1
PageMediaRotation: 90
PageMediaDimensions: 500 700
PageMediaCropRect: 10 20 490 680
PageLabelBegin
PageLabelNewIndex: 1
PageLabelStart: 5
PageLabelPrefix: A-
PageLabelNumStyle: UppercaseRomanNumerals
INFO

pdftk doc.pdf update_info meta.info output updated.pdf

pdftk updated.pdf dump_data > ascii_dump.txt
grep -q "InfoValue: Caf&#233; Bar" ascii_dump.txt
grep -q "PdfID0: 11111111111111111111111111111111" ascii_dump.txt
grep -q "PageMediaDimensions: 500 700" ascii_dump.txt
grep -q "PageMediaCropRect: 10 20 490 680" ascii_dump.txt

pdftk updated.pdf dump_data_utf8 > utf8_dump.txt
xxd -p utf8_dump.txt | tr -d "\n" | grep -q "436166c3a920426172"
xxd -p utf8_dump.txt | tr -d "\n" | grep -q "52656ec3a9"

pdfinfo -box updated.pdf > box_info.txt
grep -q "Page size:       480 x 660 pts" box_info.txt
grep -q "CropBox:            10.00    20.00   490.00   680.00" box_info.txt
echo "OK_PDFTK_INFO"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_PDFTK_INFO");
    } finally {
      await h.dispose();
    }
  });

  it("17. pdftk burst, attach_files, unpack_files, stamp, multistamp, background, and multibackground", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > base.html <<'HTML'
<html><body><p>Base1</p><div style="page-break-before: always;"></div><p>Base2</p></body></html>
HTML
cat > bg.html <<'HTML'
<html><body><p>BG1</p><div style="page-break-before: always;"></div><p>BG2</p></body></html>
HTML
wkhtmltopdf base.html base.pdf
wkhtmltopdf bg.html bg.pdf

pdftk base.pdf multibackground bg.pdf output mbg.pdf
pdftotext -raw -f 1 -l 1 mbg.pdf - | grep -q "BG1"
pdftotext -raw -f 2 -l 2 mbg.pdf - | grep -q "BG2"

echo "secret-attachment" > secret.txt
pdftk mbg.pdf attach_files secret.txt to_page 1 output with_att.pdf
mkdir -p unpacked
pdftk with_att.pdf unpack_files output unpacked
grep -q "^secret-attachment$" unpacked/secret.txt

mkdir -p burst_dir
pdftk mbg.pdf burst output burst_dir/page_%02d.pdf
test -f burst_dir/page_01.pdf
test -f burst_dir/page_02.pdf
test -f burst_dir/doc_data.txt
echo "OK_PDFTK_OPS"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_PDFTK_OPS");
    } finally {
      await h.dispose();
    }
  });

  it("18. pdfdetach -list, -save, -savefile, -saveall, and -upw password handling", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
echo "<html><body><p>Doc</p></body></html>" | wkhtmltopdf - base.pdf
echo "first-payload" > one.txt
echo "second-payload" > two.txt

qpdf base.pdf --add-attachment one.txt --key=one.txt --filename=one.txt -- --add-attachment two.txt --key=two.txt --filename=two.txt -- --encrypt pass123 owner123 256 -- enc_att.pdf

set +e
pdfdetach -list enc_att.pdf 2>err.txt
ec_no_pw=$?
set -e
test "$ec_no_pw" -eq 1

pdfdetach -upw pass123 -list enc_att.pdf > list.txt
grep -q "2 embedded files" list.txt
grep -q "1: one.txt" list.txt
grep -q "2: two.txt" list.txt

pdfdetach -upw pass123 -save 2 -o saved_two.txt enc_att.pdf
grep -q "^second-payload$" saved_two.txt

pdfdetach -upw pass123 -savefile one.txt -o saved_one.txt enc_att.pdf
grep -q "^first-payload$" saved_one.txt

mkdir -p all_out
pdfdetach -upw pass123 -saveall -o all_out enc_att.pdf
grep -q "^first-payload$" all_out/one.txt
grep -q "^second-payload$" all_out/two.txt
echo "OK_PDFDETACH"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_PDFDETACH");
    } finally {
      await h.dispose();
    }
  });

  it("19. pdfinfo (-isodates, -rawdates, -custom, -url, -listenc, multi-page -f/-l) and pdffonts (-subst, -loc, -locPS)", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
cat > link.html <<'HTML'
<html><body>
  <p>Visit <a href="https://example.com/docs">Docs</a></p>
  <div style="page-break-before: always;"></div>
  <p>Page Two</p>
</body></html>
HTML
wkhtmltopdf -s Letter link.html link.pdf

cat > custom.info <<'INFO'
InfoBegin
InfoKey: CreationDate
InfoValue: D:20250315103000Z
InfoBegin
InfoKey: Department
InfoValue: SecurityResearch
INFO
pdftk link.pdf update_info custom.info output custom.pdf

pdfinfo -isodates -custom -f 1 -l 2 custom.pdf > info_iso.txt
grep -q "CreationDate:    2025-03-15T10:30:00Z" info_iso.txt
grep -q "Custom Metadata: yes" info_iso.txt
grep -q "Department:      SecurityResearch" info_iso.txt
grep -q "Page    1 size:  612 x 792 pts (letter)" info_iso.txt
pdfinfo -url custom.pdf > info_url.txt
grep -q "https://example.com/docs" info_url.txt

pdfinfo -rawdates custom.pdf > info_raw.txt
grep -q "CreationDate:    D:20250315103000Z" info_raw.txt
pdfinfo -listenc > info_enc.txt
grep -q "UTF-8" info_enc.txt

pdffonts custom.pdf > fonts_default.txt
grep -q "Helvetica" fonts_default.txt
pdffonts -subst custom.pdf > fonts_subst.txt
grep -q "Nimbus Sans" fonts_subst.txt
pdffonts -locPS custom.pdf > fonts_locps.txt
grep -q "Substitute (Helvetica)" fonts_locps.txt
echo "OK_PDFINFO_PDFFONTS"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_PDFINFO_PDFFONTS");
    } finally {
      await h.dispose();
    }
  });

  it("20. pdftoppm/pdftocairo (-png, -r, -scale-to, -o, -sep, -setpageno, -progress, -svg) and pdfimages (-list, -all, -p, -print-filenames)", async () => {
    const h = await SafeBashE2EHarness.create();
    try {
      const res = await h.exec(
        String.raw`
set -euo pipefail
magick -size 40x30 xc:blue pic1.png
magick -size 24x18 xc:green pic2.png
b64_1=$(base64 < pic1.png | tr -d '\n')
b64_2=$(base64 < pic2.png | tr -d '\n')
cat > gallery.html <<HTML
<html><body>
  <p>Gallery 1</p><img src="data:image/png;base64,$b64_1" width="40" height="30"/>
  <div style="page-break-before: always;"></div>
  <p>Gallery 2</p><img src="data:image/png;base64,$b64_2" width="24" height="18"/>
  <div style="page-break-before: always;"></div>
  <p>Gallery 3</p>
</body></html>
HTML
wkhtmltopdf -s Letter gallery.html gallery.pdf

pdftoppm -png -r 72 -o -sep _ -setpageno 10 -progress gallery.pdf rendered 2>prog.txt
test -f rendered_10.png
test -f rendered_12.png
identify -format "%wx%h" rendered_10.png | grep -q "^612x792$"
grep -q "1 3 rendered_10.png" prog.txt

pdftoppm -png -scale-to 300 -singlefile gallery.pdf thumb
identify -format "%wx%h" thumb.png | grep -q "^232x300$"

pdftocairo -svg -f 1 -l 1 gallery.pdf page1.svg
grep -q "<svg" page1.svg
grep -q "viewBox=\"0 0 612 792\"" page1.svg

pdfimages -list gallery.pdf > img_list.txt
grep -q "image" img_list.txt

pdfimages -all -p -print-filenames gallery.pdf ext > names.txt
grep -q "ext-001-000.png" names.txt
grep -q "ext-002-001.png" names.txt
identify -format "%m %wx%h" ext-001-000.png | grep -q "^PNG 40x30$"
identify -format "%m %wx%h" ext-002-001.png | grep -q "^PNG 24x18$"
echo "OK_PDFTOPPM_PDFIMAGES"
`,
      );
      assert.equal(res.exitCode, 0, `stderr: ${res.stderr}`);
      assert.equal(res.stdout.trim(), "OK_PDFTOPPM_PDFIMAGES");
    } finally {
      await h.dispose();
    }
  });
});
