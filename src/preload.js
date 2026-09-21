const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  listTemplates: () => ipcRenderer.invoke('templates:list'),
  saveTemplate: template => ipcRenderer.invoke('templates:save', template),
  parseRows: text => ipcRenderer.invoke('rows:parse', text),
  importRows: () => ipcRenderer.invoke('rows:import'),
  openXml: () => ipcRenderer.invoke('xml:open'),
  saveXml: (filePath, text) => ipcRenderer.invoke('xml:save', filePath, text),
  importAssets: () => ipcRenderer.invoke('assets:import'),
  listAssets: () => ipcRenderer.invoke('assets:list'),
  openData: () => ipcRenderer.invoke('app:openData'),
  print: payload => ipcRenderer.invoke('print:send', payload),
  getPrinterDiagnostics: printerName => ipcRenderer.invoke('printer:diagnostics', printerName),
  calibratePrinter: (settings, template) => ipcRenderer.invoke('printer:calibrate', settings, template)
};

contextBridge.exposeInMainWorld('labelStudio', api);
