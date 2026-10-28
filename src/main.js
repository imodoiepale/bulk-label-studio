const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;

function appPaths() {
  const root = app.getPath('userData');
  const templates = path.join(root, 'templates');
  const assets = path.join(root, 'assets');
  fs.mkdirSync(templates, { recursive: true });
  fs.mkdirSync(assets, { recursive: true });
  return {
    root,
    templates,
    assets,
    settings: path.join(root, 'settings.json'),
    history: path.join(root, 'history.jsonl')
  };
}

function defaultSettings() {
  return {
    printerName: 'Xprinter XP-370B',
    labelWidthMm: 63.5,
    labelHeightMm: 38.1,
    pitchMm: 41.1,
    gapMm: 3,
    feedMode: 'SensorGap',
    printerLanguage: 'AUTO',
    maxBatch: 500,
    defaultTemplate: 'Standard Receipt'
  };
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return cleanSettings({ ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) });
  } catch {
    return fallback;
  }
}

function cleanSettings(settings) {
  const defaults = defaultSettings();
  return {
    ...defaults,
    ...settings,
    printerName: String(settings.printerName || defaults.printerName).trim() || defaults.printerName,
    feedMode: settings.feedMode || defaults.feedMode,
    printerLanguage: String(settings.printerLanguage || defaults.printerLanguage).toUpperCase(),
    maxBatch: Number(settings.maxBatch || defaults.maxBatch)
  };
}

function safeName(name) {
  return String(name || 'template').replace(/[^a-z0-9 _.-]/gi, '').trim().replace(/\s+/g, '-') || 'template';
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 700,
    title: 'Bulk Label Studio',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.setAppUserModelId('com.bulklabel.studio');

app.whenReady().then(() => {
  seedTemplate();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function seedTemplate() {
  const paths = appPaths();
  const seedPath = path.join(paths.templates, 'Standard-Receipt.json');
  if (fs.existsSync(seedPath)) return;
  const template = {
    name: 'Standard Receipt',
    widthMm: 63.5,
    heightMm: 38.1,
    pitchMm: 41.1,
    feedMode: 'SensorGap',
    gapMm: 3,
    elements: [
      { id: cryptoId(), type: 'text', label: 'Title', field: 'title', x: 72, y: 24, size: 1, value: 'VALID FOR 3 MONTHS ONLY' },
      { id: cryptoId(), type: 'barcode', label: 'Barcode', field: 'code', x: 78, y: 64, height: 72, narrow: 2, wide: 4, value: '12345678' },
      { id: cryptoId(), type: 'text', label: 'Reference', field: 'reference', x: 180, y: 148, size: 1, value: 'CU10000 - 094' },
      { id: cryptoId(), type: 'text', label: 'Price', field: 'amount', x: 196, y: 178, size: 1, value: 'KES 10,000/-' }
    ]
  };
  fs.writeFileSync(seedPath, JSON.stringify(template, null, 2));
}

function cryptoId() {
  return Math.random().toString(36).slice(2, 10);
}

function rowsFromText(text) {
  const lines = String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines[0]);
  const first = parseDelimitedLine(lines[0], delimiter).map(normalizeHeader);
  const hasHeader = first.some(x => ['code', 'product', 'reference', 'amount', 'title', 'quantity'].includes(x));
  const headers = hasHeader ? first : ['code', 'reference', 'amount', 'title', 'quantity'];
  const start = hasHeader ? 1 : 0;
  return rowsFromMatrix(lines.slice(start).map(line => parseDelimitedLine(line, delimiter)), headers);
}

function rowsFromMatrix(matrix, headers) {
  return (matrix || []).map(parts => {
    const raw = {};
    headers.forEach((key, index) => {
      if (!key) return;
      raw[key] = String(parts[index] ?? '').trim();
    });
    return normalizeProductRow(raw);
  }).filter(row => row.code);
}

function normalizeProductRow(row) {
  const product = row.product || row.name || row.description || row.item || row.itemname || '';
  const reference = row.reference || row.ref || row.sku || row.productcode || row.itemcode || product || '';
  const amount = row.amount || row.price || row.value || row.cost || '';
  return {
    code: String(row.code || row.barcode || row.upc || row.ean || row.qrcode || '').trim(),
    product: String(product || reference || '').trim(),
    reference: String(reference || product || '').trim(),
    amount: String(amount || '').trim(),
    title: String(row.title || row.label || row.message || 'VALID FOR 3 MONTHS ONLY').trim(),
    quantity: Math.max(1, Number(row.quantity || row.qty || row.copies || row.count || 1) || 1)
  };
}

function normalizeHeader(header) {
  const value = String(header || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '');
  const aliases = {
    barcode: 'code',
    barcodeno: 'code',
    barcodevalue: 'code',
    code39: 'code',
    upc: 'code',
    ean: 'code',
    qrcode: 'code',
    product: 'product',
    productname: 'product',
    name: 'product',
    item: 'product',
    itemname: 'product',
    description: 'product',
    ref: 'reference',
    sku: 'reference',
    productcode: 'reference',
    itemcode: 'reference',
    price: 'amount',
    sellingprice: 'amount',
    cost: 'amount',
    value: 'amount',
    qty: 'quantity',
    copies: 'quantity',
    count: 'quantity',
    label: 'title',
    message: 'title'
  };
  return aliases[value] || value;
}

function detectDelimiter(line) {
  if (String(line).includes('\t')) return '\t';
  if (String(line).includes(';')) return ';';
  return ',';
}

function parseDelimitedLine(line, delimiter) {
  const out = [];
  let value = '';
  let quote = false;
  const text = String(line || '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quote && text[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quote = !quote;
      }
    } else if (ch === delimiter && !quote) {
      out.push(value.trim());
      value = '';
    } else {
      value += ch;
    }
  }
  out.push(value.trim());
  return out;
}

// Excel stores 1250.5 as 1250.4999999999998; trim float noise without touching codes or text.
function cleanCellNumber(value) {
  const text = String(value ?? '');
  return /^-?\d+\.\d{8,}$/.test(text) ? String(Number(Number(text).toPrecision(12))) : text;
}

async function rowsFromWorkbook(filePath) {
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$file = $env:BULK_LABEL_IMPORT_FILE
# Share ReadWrite so a workbook that is still open in Excel can be read.
$stream = [System.IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
$zip = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Read)
try {
  $shared = @()
  $sharedEntry = $zip.GetEntry('xl/sharedStrings.xml')
  if ($sharedEntry) {
    $reader = New-Object System.IO.StreamReader($sharedEntry.Open())
    try { [xml]$sharedXml = $reader.ReadToEnd() } finally { $reader.Dispose() }
    foreach ($si in $sharedXml.sst.si) {
      if ($si.t) { $shared += [string]$si.t }
      elseif ($si.r) { $shared += (($si.r | ForEach-Object { [string]$_.t }) -join '') }
      else { $shared += '' }
    }
  }
  $wbReader = New-Object System.IO.StreamReader($zip.GetEntry('xl/workbook.xml').Open())
  try { [xml]$wbXml = $wbReader.ReadToEnd() } finally { $wbReader.Dispose() }
  $targets = @{}
  $relsEntry = $zip.GetEntry('xl/_rels/workbook.xml.rels')
  if ($relsEntry) {
    $relReader = New-Object System.IO.StreamReader($relsEntry.Open())
    try { [xml]$relXml = $relReader.ReadToEnd() } finally { $relReader.Dispose() }
    foreach ($rel in $relXml.Relationships.Relationship) { $targets[[string]$rel.Id] = ([string]$rel.Target -replace '^/?xl/','') }
  }
  $sheets = @()
  $n = 0
  foreach ($sh in $wbXml.workbook.sheets.sheet) {
    $n++
    $rid = $sh.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $target = if ($targets[$rid]) { $targets[$rid] } else { "worksheets/sheet$n.xml" }
    $sheetEntry = $zip.GetEntry('xl/' + $target)
    if (-not $sheetEntry) { continue }
  $reader = New-Object System.IO.StreamReader($sheetEntry.Open())
  try { [xml]$sheetXml = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $rows = @()
  foreach ($row in $sheetXml.worksheet.sheetData.row) {
    $cells = @{}
    $max = -1
    foreach ($c in $row.c) {
      $ref = [string]$c.r
      $letters = ($ref -replace '\\d','')
      $col = 0
      foreach ($char in $letters.ToCharArray()) { $col = ($col * 26) + ([int][char]$char - [int][char]'A' + 1) }
      $idx = $col - 1
      $max = [Math]::Max($max, $idx)
      $value = ''
      if ($c.t -eq 's') {
        $si = 0
        [void][int]::TryParse([string]$c.v, [ref]$si)
        if ($si -lt $shared.Count) { $value = $shared[$si] }
      } elseif ($c.t -eq 'inlineStr') {
        $value = [string]$c.is.t
      } else {
        $value = [string]$c.v
      }
      $cells[$idx] = $value
    }
    if ($max -ge 0) {
      $arr = @()
      for ($i = 0; $i -le $max; $i++) { $arr += [string]$cells[$i] }
      $rows += ,@($arr)
    }
  }
    $sheets += [pscustomobject]@{ name = [string]$sh.name; rows = @($rows) }
  }
  ConvertTo-Json -InputObject @($sheets) -Depth 6
} finally {
  $zip.Dispose()
}
`;
  const json = await runPowerShellCommand(ps, { BULK_LABEL_IMPORT_FILE: filePath });
  const parsed = JSON.parse(json || '[]');
  return (Array.isArray(parsed) ? parsed : [parsed]).map(sheet => {
    const rows = (sheet.rows || []).map(r => (Array.isArray(r) ? r : [r]).map(cleanCellNumber));
    return { name: sheet.name, rows: rows.length ? rowsFromMatrix(rows.slice(1), rows[0].map(normalizeHeader)) : [] };
  });
}

function expandRows(rows) {
  const expanded = [];
  for (const row of rows || []) {
    const quantity = Math.max(1, Math.min(10000, Number(row.quantity || row.qty || row.copies || 1) || 1));
    for (let i = 0; i < quantity; i++) expanded.push(row);
  }
  return expanded;
}

function buildTspl(template, settings, rows) {
  rows = expandRows(rows);
  const useSensor = settings.feedMode === 'SensorGap';
  const height = useSensor ? Number(template.heightMm || settings.labelHeightMm) : Number(template.pitchMm || settings.pitchMm);
  const gap = useSensor ? (Number(template.gapMm) || Number(settings.gapMm) || 3) : 0;
  const width = Number(template.widthMm || settings.labelWidthMm);
  const lines = [
    `SIZE ${width} mm,${height} mm`,
    `GAP ${gap} mm,0 mm`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'SHIFT 0',
    'OFFSET 0 mm'
  ];
  // Text arrives pre-rendered from the preview as 1-bit bitmaps so paper matches the screen; payload is binary.
  const parts = [Buffer.from(lines.join('\r\n') + '\r\n', 'latin1')];
  const push = line => parts.push(Buffer.from(line + '\r\n', 'latin1'));
  for (const row of rows) {
    push('CLS');
    for (const el of template.elements || []) {
      const value = String(valueForField(row, el.field, el.value)).replace(/["\r\n]/g, '');
      const x = Math.round(el.x);
      const y = Math.round(el.y);
      const bitmap = row.__bitmaps && row.__bitmaps[el.id];
      if (el.type === 'barcode') {
        // Code 128 forced to subset B (!104) so the printed width equals the preview; digits printed underneath.
        const code = value.replace(/[^ -~]/g, '').replace(/!/g, '!033');
        const narrow = Math.max(2, Math.round(el.narrow || 2));
        push(`BARCODE ${x},${y},"128M",${Math.round(el.height || 72)},1,0,${narrow},${narrow},"!104${code}"`);
      } else if (el.type === 'text' && bitmap) {
        parts.push(Buffer.from(`BITMAP ${x},${y},${bitmap.widthBytes},${bitmap.height},0,`, 'latin1'), Buffer.from(bitmap.data, 'base64'), Buffer.from('\r\n', 'latin1'));
      } else if (el.type === 'text') {
        const size = Math.max(1, Math.round(el.size || 1));
        push(`TEXT ${x},${y},"2",0,${size},${size},"${value}"`);
      }
    }
    push('PRINT 1,1');
  }
  return Buffer.concat(parts);
}

function printerLanguage(settings) {
  const explicit = String(settings.printerLanguage || 'AUTO').toUpperCase();
  if (explicit !== 'AUTO') return explicit;
  const name = `${settings.printerName || ''} ${settings.driverName || ''}`.toLowerCase();
  if (name.includes('zdesigner') || name.includes('zebra') || name.includes('tlp 2844')) return 'EPL';
  return 'TSPL';
}

function buildEpl(template, settings, rows) {
  rows = expandRows(rows);
  const widthDots = Math.round(Number(template.widthMm || settings.labelWidthMm || 63.5) / 25.4 * 203);
  const heightDots = Math.round(Number(template.heightMm || settings.labelHeightMm || 38.1) / 25.4 * 203);
  const gapDots = settings.feedMode === 'SensorGap' ? Math.max(0, Math.round((Number(template.gapMm) || Number(settings.gapMm) || 3) / 25.4 * 203)) : 0;
  const lines = [
    'N',
    `q${widthDots}`,
    `Q${heightDots},${gapDots}`
  ];
  for (const row of rows) {
    lines.push('N');
    for (const el of template.elements || []) {
      const value = String(valueForField(row, el.field, el.value)).replace(/["\r\n]/g, '');
      const x = Math.round(el.x);
      const y = Math.round(el.y);
      if (el.type === 'barcode') {
        const code = value.replace(/[^A-Za-z0-9\-.\/+% ]/g, '');
        lines.push(`B${x},${y},0,1,${Math.max(1, Math.round(el.narrow || 2))},${Math.max(2, Math.round(el.wide || 4))},${Math.round(el.height || 72)},B,"${code}"`);
      } else if (el.type === 'text') {
        const scale = Math.max(1, Math.round(el.size || 1));
        lines.push(`A${x},${y},0,3,${scale},${scale},N,"${value}"`);
      }
    }
    lines.push('P1');
  }
  return lines.join('\r\n') + '\r\n';
}

function buildZpl(template, settings, rows) {
  rows = expandRows(rows);
  const widthDots = Math.round(Number(template.widthMm || settings.labelWidthMm || 63.5) / 25.4 * 203);
  const heightDots = Math.round(Number(template.heightMm || settings.labelHeightMm || 38.1) / 25.4 * 203);
  const lines = [];
  for (const row of rows) {
    lines.push('^XA', `^PW${widthDots}`, `^LL${heightDots}`, '^LH0,0');
    for (const el of template.elements || []) {
      const value = String(valueForField(row, el.field, el.value)).replace(/[\^~\r\n]/g, '');
      const x = Math.round(el.x);
      const y = Math.round(el.y);
      if (el.type === 'barcode') {
        const code = value.replace(/[^A-Za-z0-9\-.\/+% ]/g, '');
        lines.push(`^FO${x},${y}^BY${Math.max(1, Math.round(el.narrow || 2))},2,${Math.round(el.height || 72)}^BCN,${Math.round(el.height || 72)},Y,N,N^FD${code}^FS`);
      } else if (el.type === 'text') {
        const size = Math.max(18, Math.round(16 * (Number(el.size || 1))));
        lines.push(`^FO${x},${y}^A0N,${size},${size}^FD${value}^FS`);
      }
    }
    lines.push('^XZ');
  }
  return lines.join('\r\n') + '\r\n';
}

function buildPrinterPayload(template, settings, rows) {
  const language = printerLanguage(settings);
  if (language === 'EPL') return buildEpl(template, settings, rows);
  if (language === 'ZPL') return buildZpl(template, settings, rows);
  return buildTspl(template, settings, rows);
}

function valueForField(row, field, fallback = '') {
  if (!row) return fallback || '';
  if (field === 'reference') return row.reference || row.product || fallback || '';
  if (field === 'product') return row.product || row.reference || fallback || '';
  return row[field] || fallback || '';
}

ipcMain.handle('settings:get', () => {
  const paths = appPaths();
  return readJson(paths.settings, defaultSettings());
});

ipcMain.handle('settings:save', (_event, settings) => {
  const paths = appPaths();
  fs.writeFileSync(paths.settings, JSON.stringify(cleanSettings({ ...defaultSettings(), ...settings }), null, 2));
  return true;
});

ipcMain.handle('printer:list', async () => {
  const ps = `
$printers = Get-CimInstance Win32_Printer | Sort-Object @{ Expression = 'Default'; Descending = $true }, Name | ForEach-Object {
  [pscustomobject]@{
    Name = $_.Name
    DriverName = $_.DriverName
    PortName = $_.PortName
    PrinterStatus = $_.PrinterStatus
    Default = [bool]$_.Default
    WorkOffline = [bool]$_.WorkOffline
    IsUsb = ($_.PortName -like 'USB*')
    IsLabelLikely = ($_.Name -match 'Xprinter|ZDesigner|Zebra|TLP|GK|GX|ZD|XP-|Label' -or $_.DriverName -match 'Xprinter|ZDesigner|Zebra|TLP|GK|GX|ZD|Label')
  }
}
$printers | ConvertTo-Json -Depth 4
`;
  const json = await runPowerShellCommand(ps);
  const parsed = JSON.parse(json || '[]');
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
});

ipcMain.handle('templates:list', () => {
  const paths = appPaths();
  return fs.readdirSync(paths.templates).filter(file => file.endsWith('.json')).map(file => {
    const fullPath = path.join(paths.templates, file);
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return { file, name: data.name || file.replace(/\.json$/i, ''), template: data };
  });
});

ipcMain.handle('templates:save', (_event, template) => {
  const paths = appPaths();
  const file = `${safeName(template.name)}.json`;
  fs.writeFileSync(path.join(paths.templates, file), JSON.stringify(template, null, 2));
  return { file };
});

ipcMain.handle('rows:parse', (_event, text) => rowsFromText(text));

ipcMain.handle('rows:import', async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'Product data', extensions: ['xlsx', 'csv', 'tsv', 'txt'] },
      { name: 'Excel Workbook', extensions: ['xlsx'] },
      { name: 'CSV / TSV', extensions: ['csv', 'tsv', 'txt'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  let rows;
  if (ext === '.xlsx') {
    let sheets;
    try {
      sheets = await rowsFromWorkbook(filePath);
    } catch (error) {
      const text = String(error.message || error);
      if (/being used by another process|cannot access the file/i.test(text)) throw new Error(`${path.basename(filePath)} is locked by another program. Save it in Excel and try again, or close it.`);
      throw new Error(`Could not read ${path.basename(filePath)}: ${text.split(/\r?\n/)[0]}`);
    }
    const first = sheets.find(sh => sh.rows.length) || sheets[0] || { rows: [] };
    return { filePath, rows: first.rows, sheets, sheetName: first.name };
  } else if (['.csv', '.tsv', '.txt'].includes(ext)) {
    rows = rowsFromText(fs.readFileSync(filePath, 'utf8'));
  } else {
    throw new Error('Unsupported file type. Use .xlsx, .csv, .tsv, or .txt.');
  }
  return { filePath, rows };
});

ipcMain.handle('xml:open', async () => {
  const result = await dialog.showOpenDialog({ filters: [{ name: 'Label XML', extensions: ['labelxml', 'xml'] }], properties: ['openFile'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  return { filePath, text: fs.readFileSync(filePath, 'utf8') };
});

ipcMain.handle('xml:save', async (_event, currentPath, text) => {
  let filePath = currentPath;
  if (!filePath) {
    const result = await dialog.showSaveDialog({ defaultPath: 'Label-edited.labelxml', filters: [{ name: 'Label XML', extensions: ['labelxml', 'xml'] }] });
    if (result.canceled || !result.filePath) return null;
    filePath = result.filePath;
  }
  fs.writeFileSync(filePath, text, 'utf8');
  return filePath;
});

ipcMain.handle('assets:import', async () => {
  const paths = appPaths();
  const result = await dialog.showOpenDialog({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif'] }], properties: ['openFile', 'multiSelections'] });
  if (result.canceled) return [];
  return result.filePaths.map(src => {
    const dest = path.join(paths.assets, `${Date.now()}-${path.basename(src)}`);
    fs.copyFileSync(src, dest);
    return dest;
  });
});

ipcMain.handle('assets:list', () => {
  const paths = appPaths();
  return fs.readdirSync(paths.assets).filter(file => /\.(png|jpe?g|bmp|gif)$/i.test(file)).map(file => path.join(paths.assets, file));
});

ipcMain.handle('app:openData', () => {
  shell.openPath(appPaths().root);
});

ipcMain.handle('printer:diagnostics', async (_event, printerName) => {
  const safePrinterName = String(printerName || defaultSettings().printerName).trim() || defaultSettings().printerName;
  const ps = `
$printerName = $env:BULK_LABEL_PRINTER_NAME
$printer = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $printerName } | Select-Object -First 1
$config = Get-PrintConfiguration -PrinterName $printerName -ErrorAction SilentlyContinue
$jobs = @(Get-PrintJob -PrinterName $printerName -ErrorAction SilentlyContinue)
[pscustomobject]@{
  printer = $printer | Select-Object Name,DriverName,PortName,PrinterStatus,DetectedErrorState,ExtendedDetectedErrorState,ExtendedPrinterStatus,HorizontalResolution,VerticalResolution,WorkOffline,EnableBIDI,PrinterPaperNames,Default,PrintProcessor,PrintJobDataType
  queue = $jobs | Select-Object ID,JobStatus,PagesPrinted,TotalPages,SubmittedTime
  paperSize = if ($config) { $config.PaperSize } else { $null }
  rawTicket = if ($config) { $config.PrintTicketXML } else { $null }
} | ConvertTo-Json -Depth 6
`;
  const diag = JSON.parse(await runPowerShellCommand(ps, { BULK_LABEL_PRINTER_NAME: safePrinterName }));
  // ConvertTo-Json turns an empty queue into {} and a single job into a bare object; always hand back a list.
  const queue = [].concat(diag.queue || []).filter(job => job && job.ID);
  return { ...diag, queue, ...parsePrintTicket(diag.rawTicket || '') };
});

ipcMain.handle('printer:calibrate', async (_event, settings, template) => {
  settings = cleanSettings(settings || {});
  const printerName = settings.printerName;
  const widthMm = Number(template?.widthMm || settings.labelWidthMm || 63.5);
  const heightMm = Number(template?.heightMm || settings.labelHeightMm || 38.1);
  const gapMm = Number(template?.gapMm) || Number(settings.gapMm) || 3;
  const heightDots = Math.round(heightMm / 25.4 * 203);
  const gapDots = Math.max(1, Math.round(gapMm / 25.4 * 203));
  const payload = [
    `SIZE ${widthMm} mm,${heightMm} mm`,
    `GAP ${gapMm} mm,0 mm`,
    'DIRECTION 1',
    'REFERENCE 0,0',
    'SHIFT 0',
    'OFFSET 0 mm',
    // No size hints: the printer measures the real label length and gap itself (template sizes are often wrong).
    'GAPDETECT',
    'HOME'
  ].join('\r\n') + '\r\n';
  const payloadPath = path.join(os.tmpdir(), `bulk-label-calibrate-${Date.now()}.txt`);
  fs.writeFileSync(payloadPath, payload, 'ascii');
  const script = isDev ? path.join(process.cwd(), 'tools', 'print-raw.ps1') : path.join(process.resourcesPath, 'app.asar.unpacked', 'tools', 'print-raw.ps1');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-PrinterName', printerName, '-PayloadPath', payloadPath, '-JobName', 'Bulk label sensor calibration'];
  const jobId = await runPowerShell(args);
  return { jobId: jobId.trim(), heightDots, gapDots };
});

ipcMain.handle('print:send', async (_event, { template, settings, rows, jobName }) => {
  settings = cleanSettings(settings || {});
  if (!rows || !rows.length) throw new Error('No labels to print.');
  const expanded = expandRows(rows);
  if (expanded.length > Number(settings.maxBatch || 500)) throw new Error(`Batch blocked: ${expanded.length} labels exceeds max batch.`);
  const bounds = validateTemplateBounds(template, rows);
  if (bounds.length) throw new Error(`Template is outside the printable label: ${bounds.join(' ')}`);
  // Physical calibration: rolls rarely sit exactly at the head's origin, so shift every element by the saved offset.
  const dx = Number(settings.offsetXmm || 0) / 25.4 * 203;
  const dy = Number(settings.offsetYmm || 0) / 25.4 * 203;
  template = { ...template, elements: (template.elements || []).map(el => ({ ...el, x: Math.max(0, el.x + dx), y: Math.max(0, el.y + dy) })) };
  const payload = buildPrinterPayload(template, settings, rows);
  const payloadPath = path.join(os.tmpdir(), `bulk-label-${Date.now()}.txt`);
  fs.writeFileSync(payloadPath, payload, typeof payload === 'string' ? 'ascii' : undefined);
  const script = isDev ? path.join(process.cwd(), 'tools', 'print-raw.ps1') : path.join(process.resourcesPath, 'app.asar.unpacked', 'tools', 'print-raw.ps1');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-PrinterName', settings.printerName, '-PayloadPath', payloadPath, '-JobName', jobName || 'Bulk Label Studio'];
  const jobId = await runPowerShell(args);
  const paths = appPaths();
  fs.appendFileSync(paths.history, JSON.stringify({ time: new Date().toISOString(), jobId: jobId.trim(), count: expanded.length, printer: settings.printerName, template: template.name }) + '\n');
  return { jobId: jobId.trim() };
});

function runPowerShell(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `PowerShell failed with exit code ${code}`));
    });
  });
}

function runPowerShellCommand(command, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, env: { ...process.env, ...extraEnv } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `PowerShell failed with exit code ${code}`));
    });
  });
}

// Checks the values that will actually print (not the template's sample text) with the designer's metrics,
// so this guard and the designer always agree.
function validateTemplateBounds(template, rows = [{}]) {
  const widthDots = Number(template.widthMm || 63.5) / 25.4 * 203;
  const heightDots = Number(template.heightMm || 38.1) / 25.4 * 203;
  const issues = new Set();
  for (const row of rows) {
    for (const el of template.elements || []) {
      const estimate = estimateElementBounds(el, row);
      if (estimate.x < 0 || estimate.y < 0 || estimate.x + estimate.w > widthDots + 1 || estimate.y + estimate.h > heightDots + 1) {
        issues.add(`${el.label || el.type} exceeds label boundary.`);
      }
    }
  }
  return [...issues];
}

function estimateElementBounds(el, row = {}) {
  const value = String(valueForField(row, el.field, el.value || '12345678'));
  if (el.type === 'barcode') return { x: Number(el.x || 0), y: Number(el.y || 0), w: (11 * (value.length + 2) + 13) * Math.max(2, Number(el.narrow || 2)), h: Number(el.height || 72) + 24 };
  // TSPL font "2" cell = 12 x 20 dots per size step, the same metrics the designer draws with.
  const size = Number(el.size || 1);
  return { x: Number(el.x || 0), y: Number(el.y || 0), w: value.length * 12 * size, h: 20 * size };
}

function parsePrintTicket(xml) {
  const mediaBlock = (xml.match(/<psf:Feature name="psk:PageMediaSize">[\s\S]*?<\/psf:Feature>/) || [''])[0];
  const media = {
    option: (mediaBlock.match(/<psf:Option name="([^"]+)"/) || [])[1] || null,
    width: numberFromBlock(mediaBlock, 'MediaSizeWidth'),
    height: numberFromBlock(mediaBlock, 'MediaSizeHeight'),
    stockName: valueAfterName(mediaBlock, 'StockName')
  };
  return {
    media,
    gapHeight: valueAfterName(xml, 'JobGapHeight'),
    feedOffset: valueAfterName(xml, 'JobFeedOffset'),
    mediaType: optionAfterFeature(xml, 'JobMediaType'),
    useCurrentPrinterSettings: optionAfterFeature(xml, 'JobUseCurrentPrinterSettings')
  };
}

function numberFromBlock(xml, name) {
  const pattern = new RegExp(`${name}[\\s\\S]*?<psf:Value[^>]*>(\\d+)<\\/psf:Value>`);
  const match = xml.match(pattern);
  return match ? Number(match[1]) : null;
}

function valueAfterName(xml, name) {
  const pattern = new RegExp(`${name}[\\s\\S]*?<psf:Value[^>]*>([^<]+)<\\/psf:Value>`);
  const match = xml.match(pattern);
  return match ? match[1] : null;
}

function optionAfterFeature(xml, name) {
  const pattern = new RegExp(`${name}[\\s\\S]*?<psf:Option name="([^"]+)"`);
  const match = xml.match(pattern);
  return match ? match[1] : null;
}
