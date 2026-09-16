const state = {
  settings: null,
  templates: [],
  template: null,
  selectedId: null,
  rows: [],
  xmlPath: null,
  dragging: null
};

if (!window.labelStudio) {
  const previewTemplate = {
    name: 'Standard Receipt',
    widthMm: 63.5,
    heightMm: 38.1,
    pitchMm: 41.1,
    feedMode: 'ContinuousPitch',
    gapMm: 0,
    elements: [
      { id: 'title', type: 'text', label: 'Title', field: 'title', x: 72, y: 24, size: 1, value: 'VALID FOR 3 MONTHS ONLY' },
      { id: 'barcode', type: 'barcode', label: 'Barcode', field: 'code', x: 78, y: 64, height: 72, narrow: 2, wide: 4, value: '12345678' },
      { id: 'reference', type: 'text', label: 'Reference', field: 'reference', x: 180, y: 148, size: 1, value: 'CU10000 - 094' },
      { id: 'amount', type: 'text', label: 'Price', field: 'amount', x: 196, y: 178, size: 1, value: 'KES 10,000/-' }
    ]
  };
  window.labelStudio = {
    getSettings: async () => ({ printerName: 'Xprinter XP-370B', feedMode: 'ContinuousPitch', maxBatch: 500 }),
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
    openXml: async () => null,
    saveXml: async () => null,
    importAssets: async () => [],
    listAssets: async () => [],
    openData: async () => alert('Preview mode: open the Electron app for app memory.'),
    calibratePrinter: async () => ({ jobId: 'preview', heightDots: 305, gapDots: 24 }),
    print: async () => {
      alert('Preview mode: printing works only in the Electron app.');
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
  reference: 'CU10000 - 094',
  amount: 'KES 10,000/-',
  title: 'VALID FOR 3 MONTHS ONLY'
};

const pageMeta = {
  designer: ['Visual Designer', 'Drag label elements, edit text fields, save templates, and print tests.'],
  bulk: ['Bulk Data', 'Paste rows from Excel, CSV, WhatsApp, or any copied table.'],
  xml: ['XML Editor', 'Open, inspect, edit, and save Barcode & Label XML templates.'],
  printer: ['Printer Config', 'Read the Windows driver, stock, queue, and mismatch report before printing.'],
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
  $('parseRowsBtn').addEventListener('click', parseRows);
  $('printRowsBtn').addEventListener('click', async () => {
    await parseRows();
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
  const w = Math.max(320, Math.round(mmToDots(state.template.widthMm || 63.5)));
  const pitchDots = Math.max(mmToDots(state.template.pitchMm || 41.1), mmToDots(state.template.heightMm || 38.1));
  const h = Math.max(220, Math.round(pitchDots + 64));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f3ecd8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const labelHeight = mmToDots(state.template.heightMm || 38.1);
  const pitch = mmToDots(state.template.pitchMm || state.template.heightMm || 38.1);
  const gap = Math.max(0, pitch - labelHeight);
  ctx.fillStyle = '#fff';
  roundRect(ctx, 8, 8, canvas.width - 16, Math.min(labelHeight, canvas.height - 16), 14, true, false);
  if (gap > 0 && labelHeight + 8 < canvas.height) {
    ctx.fillStyle = '#d8d0ad';
    ctx.fillRect(8, Math.min(labelHeight + 8, canvas.height - gap), canvas.width - 16, Math.min(gap, 30));
  }
  ctx.strokeStyle = '#d9e2ef';
  for (let x = 0; x < canvas.width; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 32) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  for (const el of state.template.elements || []) {
    const value = sample[el.field] || el.value || '';
    const selected = el.id === state.selectedId;
    ctx.strokeStyle = selected ? '#1167d8' : 'transparent';
    ctx.fillStyle = '#172033';
    if (el.type === 'barcode') {
      drawFakeBarcode(el.x, el.y, 250, el.height || 70, value);
      ctx.strokeRect(el.x - 6, el.y - 6, 262, (el.height || 70) + 12);
    } else {
      ctx.font = `${14 * (el.size || 1)}px Consolas`;
      ctx.fillText(value, el.x, el.y + 14);
      const width = ctx.measureText(value).width;
      ctx.strokeRect(el.x - 6, el.y - 4, width + 12, 24 * (el.size || 1));
    }
  }
  ctx.strokeStyle = '#d8aa39';
  ctx.lineWidth = 2;
  roundRect(ctx, 8, 8, canvas.width - 16, Math.min(labelHeight, canvas.height - 16), 14, false, true);
  ctx.lineWidth = 1;
  ctx.fillStyle = '#7a6a2b';
  ctx.font = '12px Segoe UI';
  ctx.fillText(`Label ${state.template.widthMm}mm x ${state.template.heightMm}mm · Pitch ${state.template.pitchMm}mm`, 14, canvas.height - 12);
}

function drawFakeBarcode(x, y, w, h, text) {
  ctx.fillStyle = '#172033';
  let cursor = x;
  for (let i = 0; cursor < x + w; i++) {
    const bar = (text.charCodeAt(i % text.length) + i) % 4 + 1;
    if (i % 2 === 0) ctx.fillRect(cursor, y, bar, h);
    cursor += bar + 2;
  }
}

function canvasDown(event) {
  const point = canvasPoint(event);
  const hit = [...state.template.elements].reverse().find(el => point.x >= el.x - 10 && point.x <= el.x + 280 && point.y >= el.y - 12 && point.y <= el.y + (el.height || 40) + 18);
  if (!hit) return;
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
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
}

async function saveTemplate() {
  readTemplateForm();
  await window.labelStudio.saveTemplate(state.template);
  await loadTemplates();
  setStatus('Template saved');
}

async function printTest() {
  await sendPrintWithConfirm([sample], 'Bulk label test');
}

async function sendPrint(rows, jobName) {
  try {
    readSettingsForm();
    readTemplateForm();
    const result = await window.labelStudio.print({ template: state.template, settings: state.settings, rows, jobName });
    setStatus(`Printed job ${result.jobId}`);
  } catch (error) {
    setStatus(error.message || String(error));
    alert(error.message || String(error));
  }
}

async function sendPrintWithConfirm(rows, jobName) {
  const issues = validateTemplateBounds();
  if (issues.length) {
    const fix = confirm(`This design may print outside the label:\n\n${issues.join('\n')}\n\nAuto-fit it before printing?`);
    if (!fix) return;
    autoFitTemplate();
    renderAll();
  }
  openPaperPreview(rows.slice(0, 5));
  const total = labelCount(rows);
  const ok = confirm(`Start printing ${total} label(s) to ${state.settings.printerName}?\n\nIf spacing drifts, use Printer Config > Recalibrate Gap Sensor, then test 5 labels only.`);
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
  if (el.type === 'barcode') return { x: Number(el.x || 0), y: Number(el.y || 0), w: 270, h: Number(el.height || 72) };
  const value = sample[el.field] || el.value || el.label || '';
  return { x: Number(el.x || 0), y: Number(el.y || 0), w: Math.max(80, String(value).length * 9 * Number(el.size || 1)), h: 28 * Number(el.size || 1) };
}

async function parseRows() {
  state.rows = await window.labelStudio.parseRows($('bulkText').value);
  $('rowPreview').innerHTML = rowsTable(state.rows);
  setStatus(`${state.rows.length} row(s), ${labelCount(state.rows)} label(s) ready`);
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
  const headers = ['code', 'reference', 'amount', 'title', 'quantity'];
  if (!rows.length) return '<div class="empty">No rows ready.</div>';
  return `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map(h => `<td>${escapeHtml(row[h] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function openPaperPreview(rows = null) {
  const validRows = Array.isArray(rows) ? rows : null;
  const sourceRows = validRows || (state.rows.length ? state.rows : [currentDesignRow()]);
  const previewRows = expandRowsForPreview(sourceRows).slice(0, 8);
  drawPaperPreview(previewRows);
  $('paperPreviewModal').classList.remove('hidden');
}

function drawPaperPreview(rows) {
  paperCtx.clearRect(0, 0, paperCanvas.width, paperCanvas.height);
  paperCtx.fillStyle = '#eef2f6';
  paperCtx.fillRect(0, 0, paperCanvas.width, paperCanvas.height);
  const scale = Math.min(1.35, (paperCanvas.width - 80) / mmToDots(state.template.widthMm || 63.5));
  const labelW = mmToDots(state.template.widthMm || 63.5) * scale;
  const labelH = mmToDots(state.template.heightMm || 38.1) * scale;
  const pitch = mmToDots(state.template.pitchMm || 41.1) * scale;
  const x = (paperCanvas.width - labelW) / 2;
  let y = 32;
  paperCtx.fillStyle = '#d6cfaa';
  roundRect(paperCtx, x - 18, 14, labelW + 36, Math.min(paperCanvas.height - 28, pitch * rows.length + 40), 12, true, false);
  rows.forEach((row, index) => {
    paperCtx.fillStyle = '#fff';
    roundRect(paperCtx, x, y, labelW, labelH, 12, true, false);
    paperCtx.strokeStyle = '#d8aa39';
    paperCtx.lineWidth = 1.5;
    roundRect(paperCtx, x, y, labelW, labelH, 12, false, true);
    drawTemplateOnContext(paperCtx, row, x, y, scale);
    paperCtx.fillStyle = '#6f7c8f';
    paperCtx.font = '12px Segoe UI';
    paperCtx.fillText(`Label ${index + 1}`, x + 8, y + labelH - 8);
    y += pitch;
  });
  paperCtx.fillStyle = '#19253a';
  paperCtx.font = '14px Segoe UI';
  paperCtx.fillText(`Previewing ${rows.length} label(s) · ${state.template.widthMm}mm x ${state.template.heightMm}mm · pitch ${state.template.pitchMm}mm`, 24, paperCanvas.height - 20);
}

function drawTemplateOnContext(targetCtx, row, offsetX, offsetY, scale) {
  for (const el of state.template.elements || []) {
    const value = String(row[el.field] || el.value || '');
    const x = offsetX + el.x * scale;
    const y = offsetY + el.y * scale;
    targetCtx.fillStyle = '#172033';
    if (el.type === 'barcode') {
      drawFakeBarcodeOn(targetCtx, x, y, barcodePreviewWidth(el) * scale, (el.height || 72) * scale, value);
    } else {
      targetCtx.font = `${14 * (el.size || 1) * scale}px Consolas`;
      targetCtx.fillText(value, x, y + 14 * scale);
    }
  }
}

function drawFakeBarcodeOn(targetCtx, x, y, w, h, text) {
  targetCtx.fillStyle = '#172033';
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
    setStatus('Printer config refreshed');
  } catch (error) {
    $('printerCards').innerHTML = `<div class="notice warning">${escapeHtml(error.message || String(error))}</div>`;
    $('mismatchReport').innerHTML = '<div class="notice warning">Unable to read printer configuration.</div>';
  }
}

async function calibratePrinter() {
  try {
    readSettingsForm();
    readTemplateForm();
    const ok = confirm(`Recalibrate the printer gap sensor for ${state.settings.printerName}?\n\nLabel: ${state.template.widthMm}mm x ${state.template.heightMm}mm\nGap: ${state.template.gapMm || 3}mm\n\nThe printer may feed blank labels while detecting the gap.`);
    if (!ok) return;
    const result = await window.labelStudio.calibratePrinter(state.settings, state.template);
    setStatus(`Calibration sent: job ${result.jobId}`);
    await refreshPrinterDiagnostics();
    alert(`Calibration sent as job ${result.jobId}.\nHeight dots: ${result.heightDots}\nGap dots: ${result.gapDots}\n\nNow print 5 labels only. If it still drifts, switch to Continuous Pitch mode and tune Pitch mm.`);
  } catch (error) {
    setStatus(error.message || String(error));
    alert(error.message || String(error));
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
}

function renderAll() {
  if (!state.template) return;
  fillTemplateForm();
  fillElementForm();
  renderElements();
  drawCanvas();
  updateDesignCopySummary();
}

function setStatus(text) {
  $('saveStatus').textContent = text;
}

function id() {
  return Math.random().toString(36).slice(2, 10);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
}

function normalizeHeader(header) {
  const value = String(header || '').toLowerCase().trim();
  if (value === 'barcode') return 'code';
  if (value === 'price') return 'amount';
  if (value === 'qty' || value === 'copies') return 'quantity';
  return value;
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

function barcodePreviewWidth(el) {
  return Math.max(220, Number(el.previewWidth || 270));
}

function currentDesignRow() {
  const row = { ...sample };
  for (const el of state.template.elements || []) {
    if (el.field && el.value) row[el.field] = el.value;
  }
  row.quantity = Math.max(1, Number($('designCopies').value || 1) || 1);
  return row;
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
  setStatus(error.message || String(error));
  alert(error.message || String(error));
});

