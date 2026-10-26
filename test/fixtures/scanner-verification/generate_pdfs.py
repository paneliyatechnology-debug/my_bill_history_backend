import os

def generate_simple_pdf(pages, output_path):
    """
    Generate a standards-compliant multi-page or single-page PDF with text stream.
    Each element in `pages` is a list of tuples: (x, y, font_size, text)
    Coordinate system: (0, 0) is bottom-left, page is 595 x 842 (A4).
    """
    objects = []
    
    # 1: Catalog
    # 2: Outlines
    # 3: Pages
    # For each page:
    #   4 + 2*i: Page object
    #   5 + 2*i: Content stream object
    # Font object at the end
    
    num_pages = len(pages)
    page_obj_ids = [4 + 2 * i for i in range(num_pages)]
    font_obj_id = 4 + 2 * num_pages
    
    # Obj 1: Catalog
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n")
    # Obj 2: Outlines
    objects.append(b"2 0 obj\n<< /Type /Outlines /Count 0 >>\nendobj\n")
    # Obj 3: Pages
    kids_str = " ".join([f"{pid} 0 R" for pid in page_obj_ids])
    objects.append(f"3 0 obj\n<< /Type /Pages /Kids [{kids_str}] /Count {num_pages} >>\nendobj\n".encode())
    
    for i, page_lines in enumerate(pages):
        page_id = 4 + 2 * i
        content_id = 5 + 2 * i
        
        # Build stream
        stream_parts = ["BT", f"/F1 12 Tf"]
        for x, y, size, text in page_lines:
            # Escape parenthesis
            escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            stream_parts.append(f"/F1 {size} Tf")
            stream_parts.append(f"{x} {y} Td")
            stream_parts.append(f"({escaped}) Tj")
            stream_parts.append(f"-{x} -{y} Td") # reset pos
        stream_parts.append("ET")
        stream_data = "\n".join(stream_parts).encode("latin1")
        
        page_dict = f"{page_id} 0 obj\n<< /Type /Page /Parent 3 0 R /MediaBox [0 0 595 842] /Contents {content_id} 0 R /Resources << /Font << /F1 {font_obj_id} 0 R >> >> >>\nendobj\n".encode()
        content_dict = f"{content_id} 0 obj\n<< /Length {len(stream_data)} >>\nstream\n".encode() + stream_data + b"\nendstream\nendobj\n"
        
        objects.append(page_dict)
        objects.append(content_dict)
        
    # Font object
    font_dict = f"{font_obj_id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n".encode()
    objects.append(font_dict)
    
    # Assemble file
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for obj in objects:
        offsets.append(len(out))
        out.extend(obj)
        
    xref_offset = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.extend(f"{off:010d} 00000 n \n".encode())
        
    out.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode())
    
    with open(output_path, "wb") as f:
        f.write(out)
    print(f"Generated: {output_path} ({len(out)} bytes)")

out_dir = "/home/dell/Jaydeep/Billing/apps/api/test/fixtures/scanner-verification"

# 1. Indian GST Invoice
indian_gst_lines = [
    (50, 800, 16, "TAX INVOICE"),
    (50, 775, 14, "SHREE KRISHNA TRADING CO"),
    (50, 758, 10, "Plot 105, GIDC Industrial Estate, Makarpura, Vadodara, Gujarat 390010"),
    (50, 744, 11, "GSTIN: 24AAAFK2233C1Z8 | State: 24-Gujarat"),
    (50, 730, 10, "Email: sales@shreekrishnatrading.com | Phone: 9825012345"),
    
    (340, 775, 11, "Invoice No: SKT/2026-27/0412"),
    (340, 758, 11, "Invoice Date: 12-10-2026"),
    (340, 744, 11, "Due Date: 26-10-2026"),
    (340, 730, 11, "Place of Supply: 24 - Gujarat"),
    
    (50, 695, 11, "Bill To / Buyer:"),
    (50, 680, 11, "PANELIYA TECHNOLOGY PRIVATE LIMITED"),
    (50, 666, 10, "Arth Business Center, Nikol, Ahmedabad, Gujarat 382350"),
    (50, 652, 11, "GSTIN: 24AARCP0909R1ZR"),
    
    (50, 610, 10, "Item Description                HSN/SAC   Qty   Unit    Rate     Taxable   GST %  Amount"),
    (50, 595, 10, "----------------------------------------------------------------------------------------------------"),
    (50, 575, 10, "Polycab 2.5 sq mm Copper Wire   8544      10    COIL   1850.00   18500.00   18%  21830.00"),
    (50, 555, 10, "Electrical Installation Service 998717     1    JOB    3500.00    3500.00   18%   4130.00"),
    (50, 535, 10, "----------------------------------------------------------------------------------------------------"),
    
    (340, 500, 10, "Subtotal: Rs. 22000.00"),
    (340, 480, 10, "Trade Discount: Rs. 500.00"),
    (340, 460, 10, "Taxable Amount: Rs. 21500.00"),
    (340, 440, 10, "CGST @ 9%: Rs. 1935.00"),
    (340, 420, 10, "SGST @ 9%: Rs. 1935.00"),
    (340, 395, 12, "Grand Total: Rs. 25370.00"),
    (50, 360, 9, "Terms: Payment due within 15 days. Subject to Vadodara jurisdiction."),
]
generate_simple_pdf([indian_gst_lines], os.path.join(out_dir, "indian_gst_invoice.pdf"))

# 2. Multi-Page PDF Invoice (2 pages)
page1_lines = [
    (50, 800, 16, "INVOICE - PAGE 1 OF 2"),
    (50, 775, 14, "NATIONAL LOGISTICS & SUPPLY CO"),
    (50, 755, 11, "GSTIN: 27AABCN8899P1Z4 | Maharashtra"),
    (50, 735, 11, "Invoice No: NL-889901"),
    (50, 715, 11, "Invoice Date: 10-10-2026"),
    (50, 680, 11, "Bill To: TradeNexa Ahmedabad"),
    (50, 660, 11, "GSTIN: 24AARCP0909R1ZR"),
    (50, 620, 10, "Line Items (Continued on Page 2):"),
    (50, 590, 10, "1. Industrial Conveyor Belt 50M | HSN: 4010 | Qty: 2 PCS | Rate: 15000.00 | Taxable: 30000.00"),
]
page2_lines = [
    (50, 800, 16, "INVOICE - PAGE 2 OF 2"),
    (50, 775, 11, "Invoice No: NL-889901 (Continued)"),
    (50, 740, 10, "2. Warehouse Storage Racks Heavy Duty | HSN: 7308 | Qty: 4 SET | Rate: 8000.00 | Taxable: 32000.00"),
    (50, 710, 10, "3. Freight & Loading Services | SAC: 996511 | Qty: 1 NOS | Rate: 5000.00 | Taxable: 5000.00"),
    (50, 670, 10, "----------------------------------------------------------------------------------------------------"),
    (340, 640, 10, "Subtotal: Rs. 67000.00"),
    (340, 620, 10, "IGST @ 18%: Rs. 12060.00"),
    (340, 590, 13, "Grand Total: Rs. 79060.00"),
    (50, 550, 10, "Authorized Signatory for NATIONAL LOGISTICS & SUPPLY CO"),
]
generate_simple_pdf([page1_lines, page2_lines], os.path.join(out_dir, "multi_page_invoice.pdf"))
