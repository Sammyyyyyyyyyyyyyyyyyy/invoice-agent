"""Generate realistic test invoice PDFs for the invoice-agent demo."""
import os, random, subprocess, sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from PIL import Image, ImageFilter, ImageEnhance
import numpy as np

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
W, H = A4
BUYER = ["Acme Retail Pvt Ltd", "4th Floor, Prestige Tech Park", "Outer Ring Road, Bengaluru 560103",
         "GSTIN: 29AABCA9876K1Z2"]


def inr(n):
    neg = n < 0
    n = abs(round(n, 2))
    whole, frac = f"{n:.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head: parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return ("-" if neg else "") + "Rs. " + whole + "." + frac


def style_a(c, d):
    """Corporate: coloured header bar, table with grid."""
    c.setFillColor(colors.HexColor(d.get("color", "#1f3b73")))
    c.rect(0, H - 90, W, 90, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 20); c.drawString(40, H - 50, d["vendor"])
    c.setFont("Helvetica", 9)
    c.drawString(40, H - 68, d["vendor_addr"]); c.drawString(40, H - 80, "GSTIN: " + d["vendor_gstin"])
    c.setFont("Helvetica-Bold", 22); c.drawRightString(W - 40, H - 55, "TAX INVOICE")
    c.setFillColor(colors.black)
    y = H - 120
    c.setFont("Helvetica-Bold", 10); c.drawString(40, y, "Bill To:")
    c.setFont("Helvetica", 10)
    for i, line in enumerate(BUYER): c.drawString(40, y - 14 * (i + 1), line)
    meta = [("Invoice No:", d["inv_no"]), ("Invoice Date:", d["date"])]
    if d.get("po"): meta.append(("PO Reference:", d["po"]))
    for i, (k, v) in enumerate(meta):
        c.setFont("Helvetica-Bold", 10); c.drawString(360, y - 14 * i, k)
        c.setFont("Helvetica", 10); c.drawString(450, y - 14 * i, v)
    return line_table(c, d, y - 100, grid=True)


def style_b(c, d):
    """Minimal: big name, thin lines, details in right column."""
    c.setFont("Helvetica-Bold", 26); c.drawString(40, H - 70, d["vendor"].upper())
    c.setFont("Helvetica", 9); c.setFillColor(colors.grey)
    c.drawString(40, H - 86, d["vendor_addr"] + "  |  GSTIN " + d["vendor_gstin"])
    c.setFillColor(colors.black)
    c.line(40, H - 100, W - 40, H - 100)
    c.setFont("Helvetica", 10)
    c.drawString(40, H - 125, f"Invoice # {d['inv_no']}")
    c.drawString(40, H - 140, f"Dated {d['date']}")
    if d.get("po"): c.drawString(40, H - 155, f"Against Purchase Order {d['po']}")
    c.drawRightString(W - 40, H - 125, "Billed to")
    for i, line in enumerate(BUYER): c.drawRightString(W - 40, H - 140 - 14 * i, line)
    return line_table(c, d, H - 230, grid=False)


def style_c(c, d):
    """Small-business / typed: centered header, simple boxes (used for the scan)."""
    c.setFont("Courier-Bold", 18); c.drawCentredString(W / 2, H - 60, d["vendor"])
    c.setFont("Courier", 9)
    c.drawCentredString(W / 2, H - 75, d["vendor_addr"])
    c.drawCentredString(W / 2, H - 87, "GST No. " + d["vendor_gstin"])
    c.setFont("Courier-Bold", 13); c.drawCentredString(W / 2, H - 115, "INVOICE")
    c.setFont("Courier", 10)
    c.drawString(40, H - 145, f"Bill No : {d['inv_no']}")
    c.drawString(40, H - 160, f"Date    : {d['date']}")
    c.drawString(320, H - 145, "To: " + BUYER[0])
    c.drawString(320, H - 160, "    " + BUYER[2])
    if d.get("note"): c.drawString(40, H - 185, d["note"])
    return line_table(c, d, H - 220, grid=True, font="Courier")


def line_table(c, d, y, grid=True, font="Helvetica"):
    cols = [40, 300, 360, 450]
    c.setFont(font + ("-Bold" if font else ""), 10)
    for x, t in zip(cols, ["Description", "Qty", "Rate", "Amount"]):
        c.drawString(x, y, t)
    c.line(40, y - 5, W - 40, y - 5)
    c.setFont(font, 10)
    yy = y - 22
    for desc, qty, rate in d["lines"]:
        c.drawString(cols[0], yy, desc); c.drawString(cols[1], yy, str(qty))
        c.drawString(cols[2], yy, inr(rate).replace("Rs. ", ""))
        c.drawRightString(W - 40, yy, inr(qty * rate).replace("Rs. ", ""))
        if grid: c.setStrokeColor(colors.lightgrey); c.line(40, yy - 6, W - 40, yy - 6); c.setStrokeColor(colors.black)
        yy -= 20
    yy -= 10
    sub = d["subtotal"]
    rows = [("Subtotal", sub), (d.get("tax_label", "IGST @ 18%"), d["tax"]), ("TOTAL PAYABLE", d["total"])]
    for i, (k, v) in enumerate(rows):
        bold = i == 2
        c.setFont(font + "-Bold" if bold else font, 11 if bold else 10)
        c.drawString(330, yy, k); c.drawRightString(W - 40, yy, inr(v))
        yy -= 18
    yy -= 30
    c.setFont(font + "-Bold", 10); c.drawString(40, yy, "Bank details for payment")
    c.setFont(font, 10)
    if d.get("bank_note"):
        c.setFillColor(colors.HexColor("#b00020")); c.drawString(40, yy - 15, d["bank_note"]); c.setFillColor(colors.black); yy -= 15
    c.drawString(40, yy - 15, f"Account name : {d['vendor']}")
    c.drawString(40, yy - 30, f"Bank         : {d['bank']}")
    c.drawString(40, yy - 45, f"Account no.  : {d['acct']}")
    c.drawString(40, yy - 60, f"IFSC         : {d['ifsc']}")
    c.setFont(font, 8); c.setFillColor(colors.grey)
    c.drawString(40, 50, "This is a computer generated invoice. Payment due within 30 days.")
    c.setFillColor(colors.black)


def make(fname, d, style):
    path = os.path.join(OUT, fname)
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle(f"Invoice {d['inv_no']}")
    {"a": style_a, "b": style_b, "c": style_c}[style](c, d)
    c.showPage(); c.save()
    return path


def scanify(pdf_path):
    """Turn a clean PDF into a 'scanned' image-only PDF: rasterise, tilt, noise, blur."""
    base = pdf_path[:-4]
    subprocess.run(["pdftoppm", "-r", "110", "-png", "-singlefile", pdf_path, base], check=True)
    img = Image.open(base + ".png").convert("L")
    img = img.rotate(1.3, expand=True, fillcolor=245)
    arr = np.array(img).astype(np.int16)
    arr = arr + np.random.default_rng(7).normal(0, 14, arr.shape).astype(np.int16)
    arr = np.clip(arr * 0.92 + 18, 0, 255).astype(np.uint8)
    img = Image.fromarray(arr).filter(ImageFilter.GaussianBlur(0.6))
    img = ImageEnhance.Contrast(img).enhance(1.15)
    img.convert("RGB").save(pdf_path, "PDF", resolution=110)
    os.remove(base + ".png")


V = {
    "dell": dict(vendor="Dell India Pvt Ltd", vendor_addr="Divyasree Greens, Koramangala, Bengaluru 560071",
                 vendor_gstin="29AAACD1234F1Z5", bank="HDFC Bank", acct="50100234567891", ifsc="HDFC0000123", color="#0b5394"),
    "ul": dict(vendor="Urban Ladder Furniture Pvt Ltd", vendor_addr="Vaswani Centropolis, Langford Road, Bengaluru 560027",
               vendor_gstin="29AADCU5566H1Z9", bank="ICICI Bank", acct="002105012345", ifsc="ICIC0000021"),
    "aws": dict(vendor="Amazon Web Services India Pvt Ltd", vendor_addr="Brigade Gateway, Malleshwaram, Bengaluru 560055",
                vendor_gstin="29AAICA3918J1ZE", bank="Citibank N.A.", acct="0123456789", ifsc="CITI0100000", color="#232f3e"),
    "swift": dict(vendor="Swift Logistics Pvt Ltd", vendor_addr="Plot 14, Peenya Industrial Area, Bengaluru 560058",
                  vendor_gstin="29AAGCS7788L1Z3", bank="State Bank of India", acct="30112233445", ifsc="SBIN0001234", color="#38761d"),
    "qos": dict(vendor="Quick Office Supplies", vendor_addr="12, 2nd Cross, Jayanagar 4th Block, Bengaluru 560011",
                vendor_gstin="29ABQPK4321M1Z7", bank="Axis Bank", acct="917020012345678", ifsc="UTIB0000456"),
    "zen": dict(vendor="Zenith Traders", vendor_addr="88, Avenue Road, Bengaluru 560002",
                vendor_gstin="29AAQFZ1122N1Z1", bank="Yes Bank", acct="045263700001234", ifsc="YESB0000452", color="#7f6000"),
}


def inv(v, inv_no, date, po, lines, sub=None, tax=None, total=None, **kw):
    s = sub if sub is not None else sum(q * r for _, q, r in lines)
    t = tax if tax is not None else round(s * 0.18, 2)
    tot = total if total is not None else round(s + t, 2)
    return {**V[v], "inv_no": inv_no, "date": date, "po": po, "lines": lines, "subtotal": s, "tax": t, "total": tot, **kw}


cases = [
    # 01 Happy path: Rs.300 over PO, inside tolerance -> APPROVE
    ("01_happy_dell_laptops.pdf", "a", inv("dell", "DI/2026/5567", "20 Nov 2026", "PO-1023",
        [("Dell Latitude 5450 Laptop (i7, 16GB)", 10, 50000), ("Courier & handling", 1, 300)])),
    # 02-04 Split invoices on PO-1045 (Rs.3,00,000)
    ("02_split_A_urbanladder.pdf", "b", inv("ul", "UL-INV-8812", "10 Nov 2026", "PO-1045",
        [("Ergonomic office chair - Model Arvo", 30, 6000)])),
    ("03_split_B_urbanladder.pdf", "b", inv("ul", "UL-INV-8840", "17 Nov 2026", "PO-1045",
        [("Height-adjustable desk - Model Rova", 10, 12000)])),
    ("04_split_C_urbanladder.pdf", "b", inv("ul", "UL-INV-8871", "23 Nov 2026", "PO-1045",
        [("Meeting room chair - Model Arvo Lite", 10, 4500)])),
    # 05 Scanned, no PO number -> REVIEW [PO issues] with suggested PO-1051
    ("05_scanned_no_po_quickoffice.pdf", "c", inv("qos", "QOS/447", "19/11/2026", None,
        [("A4 copier paper (box of 5 reams)", 40, 900), ("Whiteboard markers (pack of 10)", 30, 400)],
        note="Supply of office stationery as discussed with admin team", tax_label="CGST 9% + SGST 9%")),
    # 06 Bank details changed -> REVIEW [Bank changed]
    ("06_bank_changed_aws.pdf", "a", {**inv("aws", "AWS-IN-2026-11-0931", "21 Nov 2026", "PO-1060",
        [("AWS cloud infrastructure - October 2026", 1, 240000)]),
        "bank": "Kotak Mahindra Bank", "acct": "9912345678", "ifsc": "KKBK0000811",
        "bank_note": "Please note: our bank details have changed. Kindly remit to the account below."}),
    # 07 Vendor creep: Rs.490 over a Rs.50,000 PO (within tolerance) but 4th time in a row
    ("07_vendor_creep_swift.pdf", "a", inv("swift", "SLP/NOV/2026/112", "22 Nov 2026", "PO-1072",
        [("Freight & last-mile delivery - November 2026", 1, 50000), ("Fuel surcharge", 1, 490)])),
    # 08 Built-in: duplicate of 01 (same vendor + invoice number), re-sent a few days later
    ("08_duplicate_dell_laptops.pdf", "a", inv("dell", "DI/2026/5567", "20 Nov 2026", "PO-1023",
        [("Dell Latitude 5450 Laptop (i7, 16GB)", 10, 50000), ("Courier & handling", 1, 300)])),
    # 09 Built-in: tax math wrong (total over by Rs.2,000) -> REVIEW [Review calc]
    ("09_tax_wrong_dell_monitors.pdf", "b", inv("dell", "DI/2026/5602", "24 Nov 2026", "PO-1080",
        [("Dell 27\" UltraSharp Monitor U2724D", 6, 20000)], tax=21600, total=143600)),
    # 10 Unknown vendor -> REJECT [Invalid vendor]
    ("10_invalid_vendor_zenith.pdf", "a", inv("zen", "ZT-2291", "18 Nov 2026", "PO-1023",
        [("IT accessories - assorted", 1, 85000)])),
]

for fname, style, d in cases:
    p = make(fname, d, style)
    if "scanned" in fname:
        scanify(p)
    print("made", fname, d["subtotal"], d["tax"], d["total"])
