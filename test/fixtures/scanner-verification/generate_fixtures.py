import os
from PIL import Image, ImageDraw, ImageFont

out_dir = "/home/dell/Jaydeep/Billing/apps/api/test/fixtures/scanner-verification"
os.makedirs(out_dir, exist_ok=True)

# 1. Generate PNG Bill Photo (bill_photo.png)
def create_bill_photo():
    img = Image.new("RGB", (1200, 1600), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    
    # Try default or standard font
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)
        font_regular = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 26)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    except:
        font = ImageFont.load_default()
        font_regular = font
        font_small = font

    # Draw Invoice Header
    draw.text((100, 80), "MAHALAXMI STEEL & PIPES", fill=(0, 0, 0), font=font)
    draw.text((100, 140), "Plot 42, GIDC Estate, Vatva, Ahmedabad - 382445", fill=(40, 40, 40), font=font_small)
    draw.text((100, 180), "GSTIN: 24AADCM5566G1Z2 | Phone: 9876543210", fill=(0, 0, 0), font=font_regular)
    
    draw.line([(100, 230), (1100, 230)], fill=(0, 0, 0), width=3)
    
    draw.text((100, 260), "TAX INVOICE", fill=(0, 0, 0), font=font)
    draw.text((100, 320), "Invoice No: MSP-9912", fill=(0, 0, 0), font=font_regular)
    draw.text((100, 360), "Invoice Date: 08-10-2026", fill=(0, 0, 0), font=font_regular)
    
    # Bill To
    draw.text((650, 260), "Bill To: TradeNexa Corp", fill=(0, 0, 0), font=font_regular)
    draw.text((650, 300), "Ahmedabad, Gujarat", fill=(40, 40, 40), font=font_small)
    draw.text((650, 340), "GSTIN: 24AARCP0909R1ZR", fill=(40, 40, 40), font=font_small)

    draw.line([(100, 420), (1100, 420)], fill=(0, 0, 0), width=2)
    
    # Table Header
    draw.text((100, 440), "Item Description", fill=(0, 0, 0), font=font_regular)
    draw.text((600, 440), "HSN", fill=(0, 0, 0), font=font_regular)
    draw.text((750, 440), "Qty", fill=(0, 0, 0), font=font_regular)
    draw.text((850, 440), "Rate", fill=(0, 0, 0), font=font_regular)
    draw.text((980, 440), "Amount", fill=(0, 0, 0), font=font_regular)
    
    draw.line([(100, 480), (1100, 480)], fill=(120, 120, 120), width=1)
    
    # Line 1
    draw.text((100, 510), "TMT Steel Bars 12mm Fe500D", fill=(0, 0, 0), font=font_regular)
    draw.text((600, 510), "7214", fill=(0, 0, 0), font=font_regular)
    draw.text((750, 510), "2", fill=(0, 0, 0), font=font_regular)
    draw.text((850, 510), "4800.00", fill=(0, 0, 0), font=font_regular)
    draw.text((980, 510), "9600.00", fill=(0, 0, 0), font=font_regular)
    
    draw.line([(100, 600), (1100, 600)], fill=(0, 0, 0), width=2)
    
    # Summary
    draw.text((750, 630), "Subtotal: Rs. 9600.00", fill=(0, 0, 0), font=font_regular)
    draw.text((750, 680), "CGST 9%: Rs. 864.00", fill=(0, 0, 0), font=font_regular)
    draw.text((750, 720), "SGST 9%: Rs. 864.00", fill=(0, 0, 0), font=font_regular)
    
    draw.line([(750, 770), (1100, 770)], fill=(0, 0, 0), width=2)
    draw.text((750, 800), "Grand Total: Rs. 11328.00", fill=(0, 0, 0), font=font)
    
    img_path = os.path.join(out_dir, "bill_photo.png")
    img.save(img_path, "PNG")
    print(f"Saved: {img_path}")
    return img

# 2. Scanned Image-Only PDF (no digital text layer)
def create_scanned_pdf(img):
    pdf_path = os.path.join(out_dir, "scanned_image_only_invoice.pdf")
    img.save(pdf_path, "PDF", resolution=150.0)
    print(f"Saved: {pdf_path}")

# 3. Blank Unreadable Image
def create_unreadable_image():
    img = Image.new("RGB", (400, 400), color=(240, 240, 240))
    path = os.path.join(out_dir, "blank_unreadable.png")
    img.save(path, "PNG")
    print(f"Saved: {path}")

img = create_bill_photo()
create_scanned_pdf(img)
create_unreadable_image()
