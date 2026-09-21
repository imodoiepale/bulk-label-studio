const state = {
  settings: null,
  templates: [],
  template: null,
  selectedId: null,
  rows: [],
  xmlPath: null,
  dragging: null,
  bulkParseTimer: null,
  bulkParseDirty: false,
  bulkParseVersion: 0
};

if (!window.labelStudio) {
  const previewTemplate = {
    name: 'Standard Receipt',
    widthMm: 63.5,
    heightMm: 38.1,
    pitchMm: 41.1,
    feedMode: 'SensorGap',
    gapMm: 3,
    elements: [
      { id: 'title', type: 'text', label: 'Title', field: 'title', x: 72, y: 24, size: 1, value: 'VALID FOR 3 MONTHS ONLY' },
      { id: 'barcode', type: 'barcode', label: 'Barcode', field: 'code', x: 78, y: 64, height: 72, narrow: 2, wide: 4, value: '12345678' },
      { id: 'reference', type: 'text', label: 'Reference', field: 'reference', x: 180, y: 148, size: 1, value: 'CU10000 - 094' },
      { id: 'amount', type: 'text', label: 'Price', field: 'amount', x: 196, y: 178, size: 1, value: 'KES 10,000/-' }
    ]
  };
  window.labelStudio = {
    getSettings: async () => ({ printerName: 'Xprinter XP-370B', feedMode: 'SensorGap', maxBatch: 500 }),
    getPrinterDiagnostics: async () => ({ printer: { Name: 'Xprinter XP-370B', PortName: 'USB012', HorizontalResolution: 203, VerticalResolution: 203 }, queue: [], media: {} }),
    saveSettings: async () => true,
    listTemplates: async () => [{ file: 'preview', name: previewTemplate.name, template: structuredClone(previewTemplate) }],
    saveTemplate: async () => ({ file: 'preview' }),
    parseRows: async text => {
      const lines = String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      const headers = (lines[0] || '').split(/\t|,/).map(x => x.trim().toLowerCase());
      const start = headers.includes('code') || headers.includes('barcode') ? 1 : 0;
      const keys = start ? headers.map(normalizeHeader) : ['code', 'reference', 'amount', 'title', 'quantity'];
      return lines.slice(start).map(line => {
        const parts = line.split(/\t|,/).map(x => x.trim().replace(/^"|"$/g, ''));
        const row = {};
        keys.forEach((key, index) => row[key] = parts[index] || '');
        return { code: row.code || '', reference: row.reference || '', amount: row.amount || '', title: row.title || 'VALID FOR 3 MONTHS ONLY', quantity: Number(row.quantity || row.qty || row.copies || 1) || 1 };
      }).filter(row => row.code);
    },
    importRows: async () => {
      toast('Preview mode: Excel upload works in the desktop app.');
      return null;
    },
    openXml: async () => null,
    saveXml: async () => null,
    importAssets: async () => [],
    listAssets: async () => [],
    openData: async () => toast('Preview mode: open the Electron app for app memory.'),
    calibratePrinter: async () => ({ jobId: 'preview', heightDots: 305, gapDots: 24 }),
    print: async () => {
      toast('Preview mode: printing works only in the Electron app.');
      return { jobId: 'preview' };
    }
  };
}

const $ = id => document.getElementById(id);
const canvas = $('labelCanvas');
const ctx = canvas.getContext('2d');
const paperCanvas = $('paperPreviewCanvas');
const paperCtx = paperCanvas.getContext('2d');

const sample = {
  code: '12345678',
  product: 'Sample Product',
  reference: 'CU10000 - 094',
  amount: 'KES 10,000/-',
  title: 'VALID FOR 3 MONTHS ONLY'
};

const PAD = 28;        // canvas margin around the label, in dots
const DPMM = 203 / 25.4;
const SAFE = 16;       // recommended edge margin, in dots (2 mm)
const INK = '#16181d';

const pageMeta = {
  designer: ['Visual Designer', 'Drag label elements, edit text fields, save templates, and print tests.'],
  bulk: ['Bulk Data', 'Paste rows from Excel, CSV, WhatsApp, or any copied table.'],
  xml: ['XML Editor', 'Open, inspect, edit, and save Barcode & Label XML templates.'],
  printer: ['Printer', 'Read the Windows driver, stock, queue, and mismatch report before printing.'],
  assets: ['Design Memory', 'Store images, screenshots, prize references, and label design ideas.'],
  settings: ['Settings', 'Configure the printer, feed mode, and safety limits.']
};

async function init() {
  state.settings = await window.labelStudio.getSettings();
  state.settings.printerName = state.settings.printerName || 'Xprinter XP-370B';
  await loadTemplates();
  bindNav();
  bindDesigner();
  bindBulk();
  bindPrinter();
  bindXml();
  bindAssets();
  bindSettings();
  fillSettings();
  renderAll();
  await parseRows({ silent: true });
  refreshPrinterDiagnostics();
}

function bindNav() {
  document.querySelectorAll('.nav').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
      button.classList.add('active');
      $(button.dataset.page).classList.add('active');
      $('pageTitle').textContent = pageMeta[button.dataset.page][0];
      $('pageSub').textContent = pageMeta[button.dataset.page][1];
      $('crumbPage').textContent = button.textContent.trim();
    });
  });
  $('openDataBtn').addEventListener('click', () => window.labelStudio.openData());
  $('saveTemplateBtn').addEventListener('click', saveTemplate);
  $('printTestBtn').addEventListener('click', printTest);
  $('paperPreviewBtn').addEventListener('click', () => openPaperPreview([currentDesignRow()]));
}

async function loadTemplates() {
  state.templates = await window.labelStudio.listTemplates();
  state.template = state.templates[0]?.template;
  $('templateSelect').innerHTML = state.templates.map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`).join('');
}

function bindDesigner() {
  $('templateSelect').addEventListener('change', e => {
    state.template = structuredClone(state.templates[Number(e.target.value)].template);
    state.selectedId = null;
    renderAll();
  });
  ['templateName', 'templateWidth', 'templateHeight', 'templatePitch', 'templateGap'].forEach(id => {
    $(id).addEventListener('input', readTemplateForm);
  });
  $('addTextBtn').addEventListener('click', () => {
    state.template.elements.push({ id: id(), type: 'text', label: 'New Text', field: 'title', x: 40, y: 40, size: 1, value: 'TEXT' });
    state.selectedId = state.template.elements.at(-1).id;
    renderAll();
  });
  $('addBarcodeBtn').addEventListener('click', () => {
    state.template.elements.push({ id: id(), type: 'barcode', label: 'New Barcode', field: 'code', x: 70, y: 80, height: 70, narrow: 2, wide: 4, value: '12345678' });
    state.selectedId = state.template.elements.at(-1).id;
    renderAll();
  });
  $('autoFitBtn').addEventListener('click', () => {
    autoFitTemplate();
    renderAll();
    setStatus('Template auto-fit inside label');
  });
  $('bulkEditBtn').addEventListener('click', () => {
    $('designerBulkPanel').classList.add('open');
    $('designerBulkText').focus();
  });
  $('designCopies').addEventListener('input', updateDesignCopySummary);
  $('calibrateFromDesignerBtn').addEventListener('click', calibratePrinter);
  $('closeBulkEditBtn').addEventListener('click', () => $('designerBulkPanel').classList.remove('open'));
  $('designerPreviewBtn').addEventListener('click', () => openPaperPreview([currentDesignRow()]));
  $('startPrintBtn').addEventListener('click', startPrintProcess);
  $('designerParseRowsBtn').addEventListener('click', parseDesignerRows);
  $('designerPrintRowsBtn').addEventListener('click', async () => {
    const rows = await parseDesignerRows();
    if (!rows.length) return;
    await sendPrintWithConfirm(rows, 'Bulk label production batch');
  });
  $('closePaperPreviewBtn').addEventListener('click', () => $('paperPreviewModal').classList.add('hidden'));
  $('paperPreviewModal').addEventListener('click', event => {
    if (event.target.id === 'paperPreviewModal') $('paperPreviewModal').classList.add('hidden');
  });
  ['elLabel', 'elField', 'elX', 'elY', 'elSize', 'elHeight', 'elValue'].forEach(idName => {
    $(idName).addEventListener('input', readElementForm);
  });
  $('deleteElementBtn').addEventListener('click', () => {
    state.template.elements = state.template.elements.filter(el => el.id !== state.selectedId);
    state.selectedId = null;
    renderAll();
  });
  canvas.addEventListener('mousedown', canvasDown);
  canvas.addEventListener('mousemove', canvasMove);
  window.addEventListener('mouseup', () => { state.dragging = null; });
}

function bindBulk() {
  $('importRowsBtn').addEventListener('click', importRowsFile);
  $('csvTemplateBtn').addEventListener('click', saveCsvTemplate);
  $('bulkText').addEventListener('input', scheduleBulkParse);
  $('previewRowsPaperBtn').addEventListener('click', async () => {
    await flushBulkRows();
    if (state.rows.length) openPaperPreview(state.rows);
  });
  $('printRowsBtn').addEventListener('click', async () => {
    await flushBulkRows();
    if (!state.rows.length) return;
    await sendPrintWithConfirm(state.rows, 'Bulk label pasted rows');
  });
}

function bindPrinter() {
  $('refreshPrinterBtn').addEventListener('click', refreshPrinterDiagnostics);
  $('calibratePrinterBtn').addEventListener('click', calibratePrinter);
  $('useContinuousBtn').addEventListener('click', async () => {
    state.settings.feedMode = 'ContinuousPitch';
    $('feedMode').value = 'ContinuousPitch';
    await window.labelStudio.saveSettings(state.settings);
    refreshPrinterDiagnostics();
    setStatus('Continuous pitch mode enabled');
  });
  $('useSensorBtn').addEventListener('click', async () => {
    state.settings.feedMode = 'SensorGap';
    $('feedMode').value = 'SensorGap';
    await window.labelStudio.saveSettings(state.settings);
    refreshPrinterDiagnostics();
    setStatus('Sensor gap mode enabled');
  });
}

function bindXml() {
  $('openXmlBtn').addEventListener('click', async () => {
    const result = await window.labelStudio.openXml();
    if (!result) return;
    state.xmlPath = result.filePath;
    $('xmlPath').textContent = result.filePath;
    $('xmlText').value = result.text;
  });
  $('saveXmlBtn').addEventListener('click', async () => {
    const saved = await window.labelStudio.saveXml(state.xmlPath, $('xmlText').value);
    if (saved) {
      state.xmlPath = saved;
      $('xmlPath').textContent = saved;
      setStatus('XML saved');
    }
  });
}

function bindAssets() {
  $('importAssetBtn').addEventListener('click', async () => {
    await window.labelStudio.importAssets();
    await renderAssets();
  });
}

function bindSettings() {
  $('saveSettingsBtn').addEventListener('click', async () => {
    readSettingsForm();
    await window.labelStudio.saveSettings(state.settings);
    setStatus('Settings saved');
  });
}

function fillSettings() {
  $('printerName').value = state.settings.printerName;
  $('feedMode').value = state.settings.feedMode;
  $('maxBatch').value = state.settings.maxBatch;
}

function readSettingsForm() {
  state.settings.printerName = $('printerName').value.trim() || 'Xprinter XP-370B';
  state.settings.feedMode = $('feedMode').value;
  state.settings.maxBatch = Number($('maxBatch').value || 500);
  $('printerName').value = state.settings.printerName;
}

function readTemplateForm() {
  state.template.name = $('templateName').value;
  state.template.widthMm = Number($('templateWidth').value);
  state.template.heightMm = Number($('templateHeight').value);
  state.template.pitchMm = Number($('templatePitch').value);
  state.template.gapMm = Number($('templateGap').value);
  drawCanvas();
}

function fillTemplateForm() {
  $('templateName').value = state.template.name || '';
  $('templateWidth').value = state.template.widthMm;
  $('templateHeight').value = state.template.heightMm;
  $('templatePitch').value = state.template.pitchMm;
  $('templateGap').value = state.template.gapMm;
}

function selectedElement() {
  return state.template?.elements?.find(el => el.id === state.selectedId) || null;
}

function fillElementForm() {
  const el = selectedElement();
  const disabled = !el;
  ['elLabel', 'elField', 'elX', 'elY', 'elSize', 'elHeight', 'elValue'].forEach(name => $(name).disabled = disabled);
  $('deleteElementBtn').disabled = disabled;
  if (!el) {
    $('elLabel').value = '';
    $('elType').value = '';
    $('elValue').value = '';
    return;
  }
  $('elLabel').value = el.label || '';
  $('elType').value = el.type;
  $('elField').value = el.field || 'title';
  $('elX').value = Math.round(el.x || 0);
  $('elY').value = Math.round(el.y || 0);
  $('elSize').value = el.size || 1;
  $('elHeight').value = el.height || 70;
  $('elValue').value = el.value || '';
}

function readElementForm() {
  const el = selectedElement();
  if (!el) return;
  el.label = $('elLabel').value;
  el.field = $('elField').value;
  el.x = Number($('elX').value || 0);
  el.y = Number($('elY').value || 0);
  el.size = Number($('elSize').value || 1);
  el.height = Number($('elHeight').value || 70);
  el.value = $('elValue').value;
  renderAll();
}

function renderElements() {
  $('elementList').innerHTML = '';
  for (const el of state.template.elements || []) {
    const item = document.createElement('div');
    item.className = `element-item ${el.id === state.selectedId ? 'active' : ''}`;
    item.textContent = `${el.label || el.type} · ${el.field}`;
    item.addEventListener('click', () => {
      state.selectedId = el.id;
      renderAll();
    });
    $('elementList').appendChild(item);
  }
}

function drawCanvas() {
  if (!state.template) return;
  const labelW = mmToDots(state.template.widthMm || 63.5);
  const pitchDots = Math.max(mmToDots(state.template.pitchMm || 41.1), mmToDots(state.template.heightMm || 38.1));
  const w = Math.round(labelW + PAD * 2);
  const h = Math.round(pitchDots + PAD * 2 + 20);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const labelHeight = mmToDots(state.template.heightMm || 38.1);
  const pitch = mmToDots(state.template.pitchMm || state.template.heightMm || 38.1);
  const gap = Math.max(0, pitch - labelHeight);
  // Backing liner behind the label, then the gap band below it
  ctx.fillStyle = '#e9e3cf';
  roundRect(ctx, PAD - 10, PAD - 10, labelW + 20, pitch + 20, 10, true, false);
  ctx.translate(PAD, PAD);
  ctx.fillStyle = '#fffdf8';
  roundRect(ctx, 0, 0, labelW, labelHeight, 12, true, false);
  if (gap > 0) {
    ctx.fillStyle = 'rgba(160, 140, 90, .18)';
    ctx.fillRect(0, labelHeight, labelW, gap);
  }
  // 1 mm grid (8 dots), heavier every 5 mm
  for (let mm = 1; mm * DPMM < labelW; mm++) {
    ctx.strokeStyle = mm % 5 ? 'rgba(22, 24, 29, .035)' : 'rgba(22, 24, 29, .08)';
    ctx.beginPath(); ctx.moveTo(mm * DPMM, 0); ctx.lineTo(mm * DPMM, labelHeight); ctx.stroke();
  }
  for (let mm = 1; mm * DPMM < labelHeight; mm++) {
    ctx.strokeStyle = mm % 5 ? 'rgba(22, 24, 29, .035)' : 'rgba(22, 24, 29, .08)';
    ctx.beginPath(); ctx.moveTo(0, mm * DPMM); ctx.lineTo(labelW, mm * DPMM); ctx.stroke();
  }
  // Safe margin
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(201, 162, 74, .45)';
  ctx.strokeRect(SAFE, SAFE, labelW - SAFE * 2, labelHeight - SAFE * 2);
  ctx.setLineDash([]);
  for (const el of state.template.elements || []) {
    const value = valueForField(sample, el.field, el.value);
    const selected = el.id === state.selectedId;
    const b = estimateElementBounds(el);
    const outside = b.x < 0 || b.y < 0 || b.x + b.w > labelW || b.y + b.h > labelHeight;
    ctx.fillStyle = INK;
    if (el.type === 'barcode') {
      drawFakeBarcode(el.x, el.y, b.w, el.height || 72, value);
    } else {
      drawTspText(ctx, value, el.x, el.y, el.size || 1);
    }
    if (selected || outside) {
      ctx.strokeStyle = outside ? '#c2413b' : '#c9a24a';
      ctx.lineWidth = 2;
      ctx.fillStyle = outside ? 'rgba(194, 65, 59, .08)' : 'rgba(201, 162, 74, .10)';
      roundRect(ctx, b.x - 4, b.y - 4, b.w + 8, b.h + 8, 4, true, true);
      ctx.lineWidth = 1;
    }
  }
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 2;
  roundRect(ctx, 0, 0, labelW, labelHeight, 12, false, true);
  ctx.lineWidth = 1;
  ctx.fillStyle = '#8a7a4a';
  ctx.font = '600 12px "Segoe UI"';
  ctx.fillText(`${state.template.widthMm} × ${state.template.heightMm} mm  ·  pitch ${state.template.pitchMm} mm`, 0, pitch + 26);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// TSPL font "2" is 12 × 20 dots per character; draw the preview at that exact cell size.
function drawTspText(targetCtx, value, x, y, size, scale = 1) {
  const cellW = 12 * size * scale;
  const cellH = 20 * size * scale;
  targetCtx.save();
  targetCtx.font = `600 ${cellH}px Consolas, "Cascadia Mono", monospace`;
  targetCtx.textBaseline = 'top';
  const natural = targetCtx.measureText('M').width || cellW;
  targetCtx.translate(x, y);
  targetCtx.scale(cellW / natural, 1);
  targetCtx.fillText(String(value), 0, 0);
  targetCtx.restore();
}

function drawFakeBarcode(x, y, w, h, text) {
  ctx.fillStyle = INK;
  let cursor = x;
  for (let i = 0; cursor < x + w; i++) {
    const bar = (text.charCodeAt(i % text.length) + i) % 4 + 1;
    if (i % 2 === 0) ctx.fillRect(cursor, y, bar, h);
    cursor += bar + 2;
  }
}

function canvasDown(event) {
  const point = canvasPoint(event);
  const hit = [...state.template.elements].reverse().find(el => {
    const b = estimateElementBounds(el);
    return point.x >= b.x - 8 && point.x <= b.x + b.w + 8 && point.y >= b.y - 8 && point.y <= b.y + b.h + 8;
  });
  if (!hit) {
    state.selectedId = null;
    renderAll();
    return;
  }
  state.selectedId = hit.id;
  state.dragging = { id: hit.id, dx: point.x - hit.x, dy: point.y - hit.y };
  renderAll();
}

function canvasMove(event) {
  if (!state.dragging) return;
  const point = canvasPoint(event);
  const el = selectedElement();
  if (!el) return;
  el.x = Math.max(0, Math.round(point.x - state.dragging.dx));
  el.y = Math.max(0, Math.round(point.y - state.dragging.dy));
  renderAll();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width) - PAD,
    y: (event.clientY - rect.top) * (canvas.height / rect.height) - PAD
  };
}

async function saveTemplate() {
  readTemplateForm();
  await window.labelStudio.saveTemplate(state.template);
  await loadTemplates();
  setStatus('Template saved', 'ok');
}

async function printTest() {
  await sendPrintWithConfirm([sample], 'Bulk label test');
}

async function sendPrint(rows, jobName) {
  try {
    readSettingsForm();
    readTemplateForm();
    const result = await window.labelStudio.print({ template: state.template, settings: state.settings, rows, jobName });
    setStatus(`Sent to printer · job ${result.jobId}`, 'ok');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  }
}

async function sendPrintWithConfirm(rows, jobName) {
  const issues = validateTemplateBounds();
  if (issues.length) {
    const fix = await ask('Design is outside the label', `<p>These elements would be clipped:</p><ul>${issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul><p>Auto-fit them inside the safe margin?</p>`, 'Auto-fit');
    if (!fix) return;
    autoFitTemplate();
    renderAll();
  }
  const total = labelCount(rows);
  const t = state.template;
  const mode = state.settings.feedMode === 'SensorGap' ? `Sensor gap · ${t.gapMm || 3} mm` : `Continuous · pitch ${t.pitchMm} mm`;
  const warn = total > 5 ? '<p>Printing more than 5? Run a 5-label test first to confirm alignment.</p>' : '';
  const ok = await ask(`Print ${total} label${total === 1 ? '' : 's'}?`, `<dl>
    <dt>Printer</dt><dd>${escapeHtml(state.settings.printerName)}</dd>
    <dt>Labels</dt><dd>${total}</dd>
    <dt>Stock</dt><dd>${t.widthMm} × ${t.heightMm} mm</dd>
    <dt>Feed</dt><dd>${mode}</dd></dl>${warn}`, 'Print now');
  if (!ok) return;
  await sendPrint(rows, jobName);
}

function validateTemplateBounds() {
  const widthDots = mmToDots(state.template.widthMm || 63.5);
  const heightDots = mmToDots(state.template.heightMm || 38.1);
  const issues = [];
  for (const el of state.template.elements || []) {
    const b = estimateElementBounds(el);
    if (b.x < 0 || b.y < 0 || b.x + b.w > widthDots || b.y + b.h > heightDots) {
      issues.push(`${el.label || el.type} exceeds the ${state.template.widthMm}mm x ${state.template.heightMm}mm label.`);
    }
  }
  return issues;
}

function autoFitTemplate() {
  const widthDots = mmToDots(state.template.widthMm || 63.5);
  const heightDots = mmToDots(state.template.heightMm || 38.1);
  const margin = 18;
  for (const el of state.template.elements || []) {
    const b = estimateElementBounds(el);
    el.x = Math.round(Math.min(Math.max(Number(el.x || 0), margin), Math.max(margin, widthDots - b.w - margin)));
    el.y = Math.round(Math.min(Math.max(Number(el.y || 0), margin), Math.max(margin, heightDots - b.h - margin)));
  }
}

function estimateElementBounds(el) {
  if (el.type === 'barcode') {
    // Code 39: (value + start/stop) chars × (6 narrow + 3 wide + 1 narrow gap)
    const code = String(valueForField(sample, el.field, el.value || '12345678'));
    const narrow = Number(el.narrow || 2);
    const wide = Number(el.wide || 4);
    return { x: Number(el.x || 0), y: Number(el.y || 0), w: (code.length + 2) * (7 * narrow + 3 * wide), h: Number(el.height || 72) };
  }
  const value = valueForField(sample, el.field, el.value || el.label || '');
  return { x: Number(el.x || 0), y: Number(el.y || 0), w: String(value).length * 12 * Number(el.size || 1), h: 20 * Number(el.size || 1) };
}

function scheduleBulkParse() {
  state.bulkParseDirty = true;
  clearTimeout(state.bulkParseTimer);
  state.bulkParseTimer = setTimeout(() => {
    parseRows({ silent: true });
  }, 300);
}

async function flushBulkRows() {
  clearTimeout(state.bulkParseTimer);
  return parseRows({ silent: false });
}

async function parseRows(options = {}) {
  const silent = Boolean(options.silent);
  const version = ++state.bulkParseVersion;
  const analysis = analyzeBulkText($('bulkText').value, { silent: true });
  const rows = await window.labelStudio.parseRows($('bulkText').value);
  if (version !== state.bulkParseVersion) return state.rows;
  state.rows = rows;
  state.bulkParseDirty = false;
  $('rowPreview').innerHTML = rowsTable(state.rows);
  const msg = state.rows.length
    ? `${state.rows.length} product row(s), ${labelCount(state.rows)} label(s) ready`
    : analysis.note || 'No printable rows found. Check that your file has a barcode/code column.';
  setStatus(msg, state.rows.length ? 'info' : 'error', { toast: !silent });
  return state.rows;
}

function saveCsvTemplate() {
  const template = `barcode,product,reference,amount,title,quantity
12345678,Leather Wallet,CU10000 - 094,"KES 10,000/-",VALID FOR 3 MONTHS ONLY,5
98765432,Gift Voucher,CU10000 - 095,"KES 5,000/-",VALID FOR 3 MONTHS ONLY,2`;
  $('bulkText').value = template;
  const blob = new Blob([template + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'bulk-label-product-template.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  parseRows({ silent: true });
  setStatus('Default CSV template downloaded and loaded for editing.', 'ok');
}

async function importRowsFile() {
  try {
    const result = await window.labelStudio.importRows();
    if (!result) return;
    state.rows = result.rows || [];
    $('rowPreview').innerHTML = rowsTable(state.rows);
    $('bulkText').value = rowsToText(state.rows);
    await parseRows({ silent: true });
    const name = result.filePath ? result.filePath.split(/[\\/]/).pop() : 'uploaded file';
    setStatus(`Loaded ${state.rows.length} product row(s) from ${name}; ${labelCount(state.rows)} label(s) ready`, 'ok');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  }
}

function analyzeBulkText(text, options = {}) {
  const firstLine = String(text || '').split(/\r?\n/).find(line => line.trim());
  if (!firstLine) return { ok: false, note: 'No product rows found. Paste or upload product data with a barcode/code column.' };
  const separator = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
  const headers = parseClientDelimitedLine(firstLine, separator).map(normalizeHeader);
  const missing = [];
  if (!headers.includes('code')) missing.push('barcode/code');
  const detected = headers.filter(Boolean).join(', ');
  const note = missing.length
    ? `Template check: missing ${missing.join(', ')} column. Detected: ${detected || 'none'}.`
    : `Template check: detected columns ${detected}.`;
  if (!options.silent) setStatus(note, missing.length ? 'error' : 'ok');
  return { ok: !missing.length, note, headers };
}

function parseClientDelimitedLine(line, delimiter) {
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

async function parseDesignerRows() {
  const rows = await window.labelStudio.parseRows($('designerBulkText').value);
  state.rows = rows;
  $('designerRowPreview').innerHTML = rowsTable(rows);
  $('productionSummary').textContent = `${rows.length} row(s), ${labelCount(rows)} label(s) ready`;
  setStatus(`${rows.length} row(s), ${labelCount(rows)} label(s) ready`);
  return rows;
}

async function startPrintProcess() {
  const row = currentDesignRow();
  await sendPrintWithConfirm([row], 'Bulk label current design copies');
}

function rowsTable(rows) {
  const headers = ['code', 'product', 'reference', 'amount', 'title', 'quantity'];
  const total = labelCount(rows);
  const body = rows.length ? rows.map((row, index) => `<tr>
    <td class="row-number">${index + 1}</td>
    ${headers.map(h => `<td title="${escapeHtml(row[h] || '')}">${escapeHtml(row[h] || '')}</td>`).join('')}
  </tr>`).join('') : `<tr class="empty-row"><td class="row-number">—</td><td colspan="${headers.length}">No printable rows found. Add a barcode/code column and product rows.</td></tr>`;
  return `<div class="table-meta">${rows.length} product row(s) · ${total} label(s) queued</div>
  <table class="data-grid"><thead><tr><th class="row-number">#</th>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

function rowsToText(rows) {
  const headers = ['code', 'product', 'reference', 'amount', 'title', 'quantity'];
  return [headers.join('\t'), ...(rows || []).map(row => headers.map(h => String(row[h] ?? '').replace(/\t/g, ' ')).join('\t'))].join('\n');
}

function openPaperPreview(rows = null) {
  const validRows = Array.isArray(rows) ? rows : null;
  const sourceRows = validRows || (state.rows.length ? state.rows : [currentDesignRow()]);
  const previewRows = expandRowsForPreview(sourceRows).slice(0, 10);
  drawPaperPreview(previewRows);
  $('paperPreviewModal').classList.remove('hidden');
}

function drawPaperPreview(rows) {
  const visibleRows = rows.length ? rows : [currentDesignRow()];
  const labelDotsW = mmToDots(state.template.widthMm || 63.5);
  const labelDotsH = mmToDots(state.template.heightMm || 38.1);
  const pitchDots = mmToDots(state.template.pitchMm || 41.1);
  const cols = paperCanvas.width >= 1040 ? 5 : paperCanvas.width >= 840 ? 4 : paperCanvas.width >= 620 ? 3 : 2;
  const gapX = 18;
  const gapY = 18;
  const scale = Math.min(0.36, (paperCanvas.width - 80 - (cols - 1) * gapX) / (labelDotsW * cols));
  const labelW = labelDotsW * scale;
  const labelH = labelDotsH * scale;
  const pitch = Math.max(pitchDots * scale, labelH + 16);
  const left = Math.max(24, (paperCanvas.width - (cols * labelW + (cols - 1) * gapX)) / 2);
  const rowsNeeded = Math.ceil(visibleRows.length / cols);
  const requiredHeight = Math.max(640, 72 + rowsNeeded * (pitch + gapY) + 64);
  if (paperCanvas.height !== Math.ceil(requiredHeight)) paperCanvas.height = Math.ceil(requiredHeight);
  paperCtx.clearRect(0, 0, paperCanvas.width, paperCanvas.height);
  paperCtx.fillStyle = '#ecebe5';
  paperCtx.fillRect(0, 0, paperCanvas.width, paperCanvas.height);
  paperCtx.fillStyle = '#16181d';
  paperCtx.font = '600 16px "Segoe UI"';
  paperCtx.fillText(`Compact preview · ${visibleRows.length} label(s) shown · ${state.template.widthMm}mm x ${state.template.heightMm}mm`, 24, 34);
  visibleRows.forEach((row, index) => {
    const col = index % cols;
    const rowIndex = Math.floor(index / cols);
    const x = left + col * (labelW + gapX);
    const y = 62 + rowIndex * (pitch + gapY);
    paperCtx.fillStyle = '#e2dbc4';
    roundRect(paperCtx, x - 10, y - 10, labelW + 20, pitch + 14, 12, true, false);
    paperCtx.fillStyle = '#fff';
    roundRect(paperCtx, x, y, labelW, labelH, 12, true, false);
    paperCtx.strokeStyle = '#c9a24a';
    paperCtx.lineWidth = 1.5;
    roundRect(paperCtx, x, y, labelW, labelH, 12, false, true);
    drawTemplateOnContext(paperCtx, row, x, y, scale);
    paperCtx.fillStyle = '#8a7a4a';
    paperCtx.font = '700 12px "Segoe UI"';
    paperCtx.fillText(`#${index + 1}`, x + labelW - 28, y + 18);
  });
}

function drawTemplateOnContext(targetCtx, row, offsetX, offsetY, scale) {
  for (const el of state.template.elements || []) {
    const value = String(valueForField(row, el.field, el.value));
    const x = offsetX + el.x * scale;
    const y = offsetY + el.y * scale;
    targetCtx.fillStyle = INK;
    if (el.type === 'barcode') {
      drawFakeBarcodeOn(targetCtx, x, y, estimateElementBounds(el).w * scale, (el.height || 72) * scale, value);
    } else {
      drawTspText(targetCtx, value, x, y, el.size || 1, scale);
    }
  }
}

function drawFakeBarcodeOn(targetCtx, x, y, w, h, text) {
  targetCtx.fillStyle = INK;
  let cursor = x;
  const safeText = text || '12345678';
  for (let i = 0; cursor < x + w; i++) {
    const bar = ((safeText.charCodeAt(i % safeText.length) + i) % 4 + 1) * 1.1;
    if (i % 2 === 0) targetCtx.fillRect(cursor, y, bar, h);
    cursor += bar + 2.2;
  }
}

async function renderAssets() {
  const assets = await window.labelStudio.listAssets();
  $('assetList').innerHTML = '';
  for (const asset of assets) {
    const button = document.createElement('button');
    button.textContent = asset;
    button.addEventListener('click', () => {
      $('assetPreview').src = `file:///${asset.replace(/\\/g, '/')}`;
    });
    $('assetList').appendChild(button);
  }
}

async function refreshPrinterDiagnostics() {
  try {
    readSettingsForm();
    const diag = await window.labelStudio.getPrinterDiagnostics(state.settings.printerName);
    renderPrinterDiagnostics(diag);
  } catch (error) {
    setPrinterCard(false, 'Unavailable');
    $('printerCards').innerHTML = `<div class="notice warning">${escapeHtml(error.message || String(error))}</div>`;
    $('mismatchReport').innerHTML = '<div class="notice warning">Unable to read printer configuration.</div>';
  }
}

async function calibratePrinter() {
  try {
    readSettingsForm();
    readTemplateForm();
    const ok = await ask('Recalibrate gap sensor?', `<dl>
      <dt>Printer</dt><dd>${escapeHtml(state.settings.printerName)}</dd>
      <dt>Label</dt><dd>${state.template.widthMm} × ${state.template.heightMm} mm</dd>
      <dt>Gap</dt><dd>${state.template.gapMm || 3} mm</dd></dl>
      <p>The printer will feed a few blank labels while it measures the gap.</p>`, 'Calibrate');
    if (!ok) return;
    const result = await window.labelStudio.calibratePrinter(state.settings, state.template);
    await refreshPrinterDiagnostics();
    setStatus(`Calibrated (job ${result.jobId}, ${result.heightDots} + ${result.gapDots} dots). Next: print 5 test labels.`, 'ok');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  }
}

function renderPrinterDiagnostics(diag) {
  const p = diag.printer || {};
  const media = diag.media || {};
  const driverWidthMm = media.width ? media.width / 1000 : null;
  const driverHeightMm = media.height ? media.height / 1000 : null;
  const queueCount = Array.isArray(diag.queue) ? diag.queue.length : diag.queue ? 1 : 0;
  const cards = [
    ['Printer', p.Name || state.settings.printerName],
    ['Driver', p.DriverName || 'Unknown'],
    ['Port', p.PortName || 'Unknown'],
    ['Status', p.WorkOffline ? 'Offline' : 'Online / ready'],
    ['DPI', `${p.HorizontalResolution || '?'} x ${p.VerticalResolution || '?'}`],
    ['Queue', `${queueCount} job(s)`],
    ['Driver stock', `${media.stockName || media.option || 'Unknown'}`],
    ['Driver size', driverWidthMm ? `${driverWidthMm.toFixed(1)} x ${driverHeightMm.toFixed(1)} mm` : 'Unknown'],
    ['Driver gap', diag.gapHeight || 'Unknown'],
    ['Feed offset', diag.feedOffset || 'Unknown'],
    ['Raw mode', p.PrintJobDataType || 'Unknown']
  ];
  $('printerCards').innerHTML = cards.map(([label, value]) => `<div class="diag-card"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join('');
  const templateWidth = Number(state.template?.widthMm || 63.5);
  const templateHeight = Number(state.template?.heightMm || 38.1);
  const mismatches = [];
  if (driverWidthMm && Math.abs(driverWidthMm - templateWidth) > 1) {
    mismatches.push(`Driver stock width is ${driverWidthMm.toFixed(1)} mm, but app template is ${templateWidth.toFixed(1)} mm.`);
  }
  if (driverHeightMm && Math.abs(driverHeightMm - templateHeight) > 1) {
    mismatches.push(`Driver stock height is ${driverHeightMm.toFixed(1)} mm, but app label height is ${templateHeight.toFixed(1)} mm.`);
  }
  if (state.settings.feedMode === 'ContinuousPitch') {
    mismatches.push('App is using ContinuousPitch RAW TSPL mode, so it intentionally bypasses the incorrect Windows stock size and feeds by exact pitch.');
  } else {
    mismatches.push('SensorGap mode depends on the physical gap sensor. If printed labels drift, recalibrate the sensor and make sure the roll is centered under the gap sensor.');
  }
  mismatches.push('Drift is caused by feed pitch/sensor detection, not by the visual center of the canvas. Use 5-label tests before bulk printing.');
  const report = mismatches.length
    ? mismatches.map(text => `<div class="notice ${text.includes('bypasses') ? 'good' : 'warning'}">${escapeHtml(text)}</div>`).join('')
    : '<div class="notice good">No major driver/template mismatch detected.</div>';
  $('mismatchReport').innerHTML = report;
  $('printerRawTicket').value = diag.rawTicket || '';
  setPrinterCard(!p.WorkOffline && !!p.Name, p.WorkOffline ? 'Offline' : p.Name ? `Ready · ${p.PortName || ''}` : 'Not found', p.Name);
}

function renderAll() {
  if (!state.template) return;
  fillTemplateForm();
  fillElementForm();
  renderElements();
  drawCanvas();
  updateDesignCopySummary();
}

function setStatus(text, kind = 'info', options = {}) {
  $('saveStatus').textContent = text;
  if (options.toast !== false) toast(text, kind);
}

function toast(text, kind = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, kind === 'error' ? 7000 : 3500);
}

function ask(title, html, okLabel = 'Continue') {
  return new Promise(resolve => {
    $('askTitle').textContent = title;
    $('askBody').innerHTML = html;
    $('askOk').textContent = okLabel;
    $('askModal').classList.remove('hidden');
    $('askOk').focus();
    const done = value => {
      $('askModal').classList.add('hidden');
      $('askOk').onclick = $('askCancel').onclick = $('askModal').onclick = document.onkeydown = null;
      resolve(value);
    };
    $('askOk').onclick = () => done(true);
    $('askCancel').onclick = () => done(false);
    $('askModal').onclick = e => { if (e.target.id === 'askModal') done(false); };
    document.onkeydown = e => { if (e.key === 'Escape') done(false); };
  });
}

function setPrinterCard(ok, stateText, name) {
  $('pcDot').className = `dot ${ok ? 'ok' : 'bad'}`;
  $('pcState').textContent = stateText;
  if (name) $('pcName').textContent = name;
  const t = state.template || {};
  $('pcStock').textContent = `${t.widthMm || 63.5} × ${t.heightMm || 38.1} mm`;
  const sensor = state.settings?.feedMode === 'SensorGap';
  $('pcMode').textContent = sensor ? 'Sensor gap' : 'Continuous';
  $('useSensorBtn').classList.toggle('on', sensor);
  $('useContinuousBtn').classList.toggle('on', !sensor);
}

function id() {
  return Math.random().toString(36).slice(2, 10);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
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

function labelCount(rows) {
  return (rows || []).reduce((sum, row) => sum + Math.max(1, Number(row.quantity || row.qty || row.copies || 1) || 1), 0);
}

function expandRowsForPreview(rows) {
  const expanded = [];
  for (const row of rows || []) {
    const count = Math.max(1, Number(row.quantity || row.qty || row.copies || 1) || 1);
    for (let i = 0; i < count; i++) expanded.push(row);
  }
  return expanded;
}

function currentDesignRow() {
  const row = { ...sample };
  for (const el of state.template.elements || []) {
    if (el.field && el.value) row[el.field] = el.value;
  }
  row.quantity = Math.max(1, Number($('designCopies').value || 1) || 1);
  return row;
}

function valueForField(row, field, fallback = '') {
  if (!row) return fallback || '';
  if (field === 'reference') return row.reference || row.product || fallback || '';
  if (field === 'product') return row.product || row.reference || fallback || '';
  return row[field] || fallback || '';
}

function updateDesignCopySummary() {
  if (!$('productionSummary') || !$('designCopies')) return;
  const copies = Math.max(1, Number($('designCopies').value || 1) || 1);
  $('productionSummary').textContent = `${copies} copy/copies of current design ready`;
}

function mmToDots(mm) {
  return Number(mm || 0) / 25.4 * 203;
}

function roundRect(targetCtx, x, y, width, height, radius, fill, stroke) {
  const r = Math.min(radius, width / 2, height / 2);
  targetCtx.beginPath();
  targetCtx.moveTo(x + r, y);
  targetCtx.arcTo(x + width, y, x + width, y + height, r);
  targetCtx.arcTo(x + width, y + height, x, y + height, r);
  targetCtx.arcTo(x, y + height, x, y, r);
  targetCtx.arcTo(x, y, x + width, y, r);
  targetCtx.closePath();
  if (fill) targetCtx.fill();
  if (stroke) targetCtx.stroke();
}

init().then(renderAssets).catch(error => {
  setStatus(error.message || String(error), 'error');
});

