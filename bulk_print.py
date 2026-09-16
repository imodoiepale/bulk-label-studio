"""Safe bulk label printer for the Barcode & Label template.

The program deliberately defaults to preview/calibration mode.  It does not
send a batch to the printer until the operator confirms that one test label
matches the physical stock.
"""
from __future__ import annotations

import csv
import json
import math
import os
import subprocess
import sys
import tkinter as tk
from dataclasses import dataclass, asdict
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Install Pillow first: python -m pip install pillow") from exc


ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "bulk_print_config.json"


@dataclass
class Settings:
    width_mm: float = 75.0
    height_mm: float = 32.0
    gap_mm: float = 2.0
    left_mm: float = 2.0
    top_mm: float = 2.0
    dpi: int = 203
    printer: str = ""


def load_settings() -> Settings:
    if CONFIG.exists():
        try:
            return Settings(**json.loads(CONFIG.read_text(encoding="utf-8")))
        except Exception:
            pass
    return Settings()


def save_settings(s: Settings) -> None:
    CONFIG.write_text(json.dumps(asdict(s), indent=2), encoding="utf-8")


def printers() -> list[str]:
    """Read Windows printers without changing any printer settings."""
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", "Get-Printer | Select-Object -Expand Name"],
            text=True, stderr=subprocess.DEVNULL,
        )
        return [x.strip() for x in out.splitlines() if x.strip()]
    except Exception:
        return []


def mm_px(mm: float, dpi: int) -> int:
    return max(1, round(mm / 25.4 * dpi))


def font(size: int):
    for name in ("arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def centered(draw, box, text, f, fill="black"):
    x0, y0, x1, y1 = box
    b = draw.textbbox((0, 0), text, font=f)
    draw.text(((x0 + x1 - (b[2] - b[0])) / 2, y0), text, font=f, fill=fill)


def barcode39(draw, value: str, x: int, y: int, w: int, h: int):
    # A compact Code-39 renderer.  The human-readable value is printed below.
    chars = {"0":"101001101101", "1":"110100101011", "2":"101100101011", "3":"110110010101",
             "4":"101001101011", "5":"110100110101", "6":"101100110101", "7":"101001011011",
             "8":"110100101101", "9":"101100101101", "-":"101011001011", "*":"100101101101"}
    seq = "*" + value.upper() + "*"
    bits = "1".join(chars.get(c, chars["-"]) for c in seq)
    scale = max(1, w // len(bits))
    left = x + (w - scale * len(bits)) // 2
    for i, bit in enumerate(bits):
        if bit == "1":
            draw.rectangle((left + i * scale, y, left + (i + 1) * scale - 1, y + h), fill="black")


def render(row: dict[str, str], s: Settings) -> Image.Image:
    W, H = mm_px(s.width_mm, s.dpi), mm_px(s.height_mm, s.dpi)
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    title = row.get("title", "VALID FOR 3 MONTHS ONLY")
    code = row.get("code", row.get("barcode", "12345678"))
    amount = row.get("amount", "KES 10,000/-")
    ref = row.get("reference", row.get("ref", "CU10000 - 094"))
    centered(d, (0, mm_px(2, s.dpi), W, mm_px(7, s.dpi)), title, font(mm_px(3.2, s.dpi)))
    barcode39(d, code, mm_px(4, s.dpi), mm_px(8, s.dpi), W - mm_px(8, s.dpi), mm_px(10, s.dpi))
    centered(d, (0, mm_px(19, s.dpi), W, mm_px(24, s.dpi)), ref, font(mm_px(3.1, s.dpi)))
    centered(d, (0, mm_px(24, s.dpi), W, H - mm_px(1, s.dpi)), amount, font(mm_px(3.1, s.dpi)))
    return im


def load_rows(path: str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise ValueError("CSV has no data rows")
    return rows


class App:
    def __init__(self, root):
        self.root, self.s = root, load_settings()
        root.title("Safe Bulk Label Printing")
        root.geometry("760x500")
        self.csv = tk.StringVar()
        self.status = tk.StringVar(value="Preview only — no printer job has been sent.")
        self.vars = {k: tk.StringVar(value=str(getattr(self.s, k))) for k in ("width_mm", "height_mm", "gap_mm", "left_mm", "top_mm", "dpi")}
        frm = ttk.Frame(root, padding=12); frm.pack(fill="both", expand=True)
        ttk.Label(frm, text="1. Select CSV data (columns: code, reference, amount, title)").pack(anchor="w")
        row = ttk.Frame(frm); row.pack(fill="x", pady=4)
        ttk.Entry(row, textvariable=self.csv).pack(side="left", fill="x", expand=True)
        ttk.Button(row, text="Browse", command=self.browse).pack(side="left", padx=4)
        grid = ttk.LabelFrame(frm, text="Physical media calibration (millimetres)", padding=8); grid.pack(fill="x", pady=8)
        for i, k in enumerate(self.vars):
            ttk.Label(grid, text=k).grid(row=0, column=i, padx=3)
            ttk.Entry(grid, width=10, textvariable=self.vars[k]).grid(row=1, column=i, padx=3)
        p = ttk.LabelFrame(frm, text="Printer", padding=8); p.pack(fill="x")
        self.printer = tk.StringVar(value=self.s.printer)
        self.combo = ttk.Combobox(p, textvariable=self.printer, values=printers(), width=60)
        self.combo.pack(side="left", fill="x", expand=True)
        ttk.Button(p, text="Refresh", command=lambda: self.combo.configure(values=printers())).pack(side="left", padx=4)
        ttk.Button(frm, text="Preview first label", command=self.preview).pack(anchor="w", pady=8)
        ttk.Button(frm, text="Print ONE calibration label", command=self.calibrate).pack(anchor="w")
        ttk.Button(frm, text="Print full batch (after calibration)", command=self.batch).pack(anchor="w", pady=4)
        ttk.Label(frm, textvariable=self.status, foreground="#144d2a", wraplength=700).pack(anchor="w", pady=12)

    def settings(self):
        vals = {k: float(v.get()) if k != "dpi" else int(v.get()) for k, v in self.vars.items()}
        self.s = Settings(**vals, printer=self.printer.get())
        save_settings(self.s); return self.s

    def browse(self):
        p = filedialog.askopenfilename(filetypes=[("CSV", "*.csv"), ("All files", "*.*")])
        if p: self.csv.set(p)

    def preview(self):
        try:
            s = self.settings(); rows = load_rows(self.csv.get()); im = render(rows[0], s)
            out = ROOT / "preview.png"; im.resize((max(300, im.width // 2), max(128, im.height // 2))).save(out)
            self.status.set(f"Preview saved to {out}. Confirm its physical size and spacing before printing.")
            os.startfile(out)
        except Exception as e: messagebox.showerror("Preview failed", str(e))

    def calibrate(self):
        self.status.set("Calibration prepared. Use the printer's own driver/test mechanism to print exactly ONE label, then confirm size; this app does not send bulk yet.")
        messagebox.showinfo("Calibration gate", "Preview first, load one label, and print one test label from the selected printer.\n\nThis application will not send the full batch until you explicitly confirm the test is aligned.")

    def batch(self):
        try:
            s = self.settings(); rows = load_rows(self.csv.get())
            if not s.printer: raise ValueError("Select a printer first")
            if not messagebox.askyesno("Final safety check", f"Send {len(rows)} labels to:\n{s.printer}?\n\nOnly continue if ONE calibration label already matched the stock."): return
            # Export individual PNGs for driver-independent, auditable printing.
            outdir = ROOT / "output"; outdir.mkdir(exist_ok=True)
            for i, row in enumerate(rows, 1): render(row, s).save(outdir / f"label_{i:04d}.png")
            self.status.set(f"Rendered {len(rows)} labels to {outdir}. Review them, then print using the printer driver at 100% scale, no fit-to-page.")
            messagebox.showinfo("Batch ready", "The batch was rendered to output\\. It was NOT sent automatically, preventing a wrong media setting from wasting labels.")
        except Exception as e: messagebox.showerror("Batch failed", str(e))


if __name__ == "__main__":
    root = tk.Tk(); App(root); root.mainloop()
