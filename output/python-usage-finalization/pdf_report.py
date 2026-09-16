from pathlib import Path
from fpdf import FPDF
from pypdf import PdfReader, PdfWriter

output = Path("report.pdf")
pdf = FPDF()
pdf.add_page()
pdf.set_font("Helvetica", size=16)
pdf.cell(text="Quarterly report")
pdf.add_page()
pdf.set_font("Helvetica", size=12)
pdf.cell(text="Second page")
pdf.output(str(output))
with output.open("rb") as source:
    reader = PdfReader(source)
    assert len(reader.pages) == 2
    assert "Quarterly report" in reader.pages[0].extract_text()
    writer = PdfWriter()
    writer.add_page(reader.pages[0])
    writer.add_metadata({"/Title": "Extracted report"})
    with open("first-page.pdf", "wb") as destination:
        writer.write(destination)
with open("first-page.pdf", "rb") as source:
    assert len(PdfReader(source).pages) == 1
print("report.pdf generated; first-page.pdf reopened")
