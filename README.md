# Bulk Label Studio

Bulk Label Studio is a Windows Electron desktop app for designing, previewing, calibrating, and bulk-printing roll labels on an Xprinter XP-370B using RAW TSPL commands.

## What it does

- visual label canvas with draggable text and barcode elements
- one-design-many-copies printing from the Designer screen
- uploaded `.xlsx`, `.csv`, `.tsv`, or pasted rows where every product can have its own barcode
- paper preview that repeats labels on the roll before printing
- printer diagnostics for Windows driver, stock size, queue, port, and DPI
- gap sensor recalibration command for TSPL printers
- Continuous Pitch mode for bypassing incorrect Windows stock settings
- template saving, XML editor, design/image memory, and local settings

## Run the desktop app

```powershell
.\Start-Bulk-Label-Studio.cmd
```

The current runnable desktop build is here:

```text
dist\win-unpacked\Bulk Label Studio.exe
```

## Build

```powershell
$env:NPM_CONFIG_CACHE = "$PWD\.npm-cache"
$env:ELECTRON_CACHE = "$PWD\.electron-cache"
$env:ELECTRON_BUILDER_CACHE = "$PWD\.electron-builder-cache"
npm run build
```

The installer target is configured as:

```text
dist\Bulk-Label-Studio-Setup-1.0.0.exe
```

If Windows locks the NSIS builder cache, the unpacked app EXE under `dist\win-unpacked` is still usable.

## Printing one design multiple times

Use the Designer screen:

1. design the label on the canvas
2. set **Copies** to the number required
3. click **Preview Paper**
4. click **Start Print Process**

This prints the same canvas design repeatedly. It does not require a CSV.

## Product barcode batches

Use the Bulk Data screen to upload Excel/CSV or paste rows. Every row becomes its own label, so different products can print different barcodes in the same batch.

```csv
barcode,product,reference,price,title,quantity
12345678,Leather Wallet,CU10000 - 094,"KES 10,000/-",VALID FOR 3 MONTHS ONLY,5
98765432,Gift Voucher,CU10000 - 095,"KES 5,000/-",VALID FOR 3 MONTHS ONLY,2
```

Accepted aliases:

- `barcode`, `upc`, `ean` -> `code`
- `product`, `product name`, `name`, `description`, `item` -> `product`
- `sku`, `ref`, `product code`, `item code` -> `reference`
- `price` -> `amount`
- `qty` or `copies` -> `quantity`

Recommended workflow:

1. click **Upload Excel/CSV**
2. check the product/barcode preview table
3. open **Paper Preview**
4. print 5 labels first
5. print the full product batch only after the barcodes and spacing are confirmed

## Current printer baseline

The physical label stock measured during setup:

```text
Label width: 63.5 mm
Label height: 38.1 mm
Pitch: 41.1 mm
Gap: about 3 mm
Printer: Xprinter XP-370B
Port: USB012
DPI: 203
```

Default feed mode is **Sensor gap** with a 3 mm gap: the printer re-syncs on every gap, so small errors never accumulate across a long batch. Continuous Pitch feeds a fixed 41.1 mm per label and any error adds up, so use it only if the sensor cannot see the gap.

Safe workflow: **Printer > Recalibrate Gap Sensor** → print 5 labels (`.\print_random_test.ps1`) → check alignment → bulk print. The app asks for confirmation before every job and warns on batches over 5.

## Why drift can happen

The Windows driver stock can be different from the real label roll. RAW TSPL printing avoids most driver scaling, but the printer still needs either:

- an accurate gap sensor calibration, or
- an accurate continuous pitch value.

Canvas centering and printer feed drift are separate issues. The preview shows the design placement; the printer settings control where each next label starts.
