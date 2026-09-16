# Bulk Label Studio

Bulk Label Studio is a Windows Electron desktop app for designing, previewing, calibrating, and bulk-printing roll labels on an Xprinter XP-370B using RAW TSPL commands.

## What it does

- visual label canvas with draggable text and barcode elements
- one-design-many-copies printing from the Designer screen
- pasted bulk rows from Excel/CSV with `quantity`, `qty`, or `copies`
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

## Bulk rows

Use the Bulk Data screen or Designer > Bulk Edit. Paste rows like:

```csv
code,reference,amount,title,quantity
12345678,CU10000 - 094,"KES 10,000/-",VALID FOR 3 MONTHS ONLY,5
```

Accepted aliases:

- `barcode` -> `code`
- `price` -> `amount`
- `qty` or `copies` -> `quantity`

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

If printed labels drift, first use **Printer Config > Recalibrate Gap Sensor**, then test 5 labels only. If the sensor still drifts, switch to **Continuous Pitch** and tune Pitch mm.

## Why drift can happen

The Windows driver stock can be different from the real label roll. RAW TSPL printing avoids most driver scaling, but the printer still needs either:

- an accurate gap sensor calibration, or
- an accurate continuous pitch value.

Canvas centering and printer feed drift are separate issues. The preview shows the design placement; the printer settings control where each next label starts.
