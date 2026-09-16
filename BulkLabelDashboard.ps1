param([switch]$NoGui)

$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $AppRoot 'data'
$AssetsDir = Join-Path $DataDir 'assets'
$ConfigPath = Join-Path $DataDir 'settings.json'
$HistoryPath = Join-Path $DataDir 'history.jsonl'
$PastedRowsPath = Join-Path $DataDir 'pasted_rows.csv'

if (-not (Test-Path -LiteralPath $DataDir)) {
 New-Item -ItemType Directory -Path $DataDir | Out-Null
}
if (-not (Test-Path -LiteralPath $AssetsDir)) {
 New-Item -ItemType Directory -Path $AssetsDir | Out-Null
}

Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public class BulkLabelRawSpool {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public class Doc { public string name; public string file=null; public string type="RAW"; }
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool OpenPrinter(string name,out IntPtr h,IntPtr defaults);
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern int StartDocPrinter(IntPtr h,int level,Doc doc);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr h,byte[] data,int count,out int written);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
 [DllImport("winspool.drv")] static extern bool ClosePrinter(IntPtr h);
 public static int Send(string printerName,string docName,string text) {
  IntPtr h; if(!OpenPrinter(printerName,out h,IntPtr.Zero)) throw new Win32Exception();
  try {
   Doc doc = new Doc(); doc.name = docName;
   int id=StartDocPrinter(h,1,doc); if(id==0) throw new Win32Exception();
   byte[] bytes=System.Text.Encoding.ASCII.GetBytes(text); int written;
   if(!WritePrinter(h,bytes,bytes.Length,out written) || written!=bytes.Length) throw new Exception("Write incomplete; inspect the queue before retrying.");
   if(!EndDocPrinter(h)) throw new Win32Exception();
   return id;
  } finally { ClosePrinter(h); }
 }
}
'@

function Get-DefaultConfig {
 [ordered]@{
  printerName = 'Xprinter XP-370B'
  xmlPath = 'C:\Users\itsupport\Downloads\Label.labelxml'
  csvPath = (Join-Path $AppRoot 'random_test.csv')
  labelWidthMm = 63.5
  labelHeightMm = 38.1
  pitchMm = 41.1
  gapMm = 0
  mode = 'ContinuousPitch'
  titleX = 72
  titleY = 24
  barcodeX = 78
  barcodeY = 64
  barcodeHeight = 72
  barcodeNarrow = 2
  barcodeWide = 4
  referenceX = 180
  referenceY = 148
  amountX = 196
  amountY = 178
  maxBatch = 500
 }
}

function Load-Config {
 $defaults = Get-DefaultConfig
 if (Test-Path -LiteralPath $ConfigPath) {
  $saved = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
  foreach ($p in $saved.PSObject.Properties) { $defaults[$p.Name] = $p.Value }
 }
 [pscustomobject]$defaults
}

function Save-Config($Config) {
 $Config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
}

function Add-History($Record) {
 $Record | ConvertTo-Json -Compress | Add-Content -LiteralPath $HistoryPath -Encoding UTF8
}

function Get-RecentHistory {
 if (-not (Test-Path -LiteralPath $HistoryPath)) { return @() }
 Get-Content -LiteralPath $HistoryPath -Tail 40 | ForEach-Object {
  try { $_ | ConvertFrom-Json } catch { $null }
 } | Where-Object { $null -ne $_ }
}

function Get-TemplateRows($XmlPath) {
 if (-not (Test-Path -LiteralPath $XmlPath)) { throw "XML template not found: $XmlPath" }
 [xml]$xml = Get-Content -Raw -LiteralPath $XmlPath
 $shapes = $xml.BarcodeNLabel.FixedPage.ShapeList.XShape
 $texts = @($shapes | Where-Object ShapeType -eq 'XText' | Sort-Object { [double]$_.y })
 $barcode = $shapes | Where-Object ShapeType -eq 'XBarcode' | Select-Object -First 1
 if ($texts.Count -lt 3 -or -not $barcode) { throw 'The XML template does not contain the expected title, barcode, reference, and amount fields.' }
 @([pscustomobject]@{
  code = $barcode.TextValue.Trim()
  reference = $texts[1].TextValue.Trim()
  amount = $texts[2].TextValue.Trim()
  title = $texts[0].TextValue.Trim()
 })
}

function Get-CsvRows($CsvPath) {
 if (-not (Test-Path -LiteralPath $CsvPath)) { throw "CSV not found: $CsvPath" }
 $rows = Import-Csv -LiteralPath $CsvPath
 foreach ($row in $rows) {
  if (-not $row.code) { throw 'CSV must include a code column.' }
  [pscustomobject]@{
   code = [string]$row.code
   reference = if ($row.reference) { [string]$row.reference } else { '' }
   amount = if ($row.amount) { [string]$row.amount } else { '' }
   title = if ($row.title) { [string]$row.title } else { 'VALID FOR 3 MONTHS ONLY' }
  }
 }
}

function Convert-PastedTextToRows($Text) {
 $lines = @($Text -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
 if ($lines.Count -lt 1) { throw 'Nothing was pasted.' }
 $rows = [System.Collections.Generic.List[object]]::new()
 $firstParts = @($lines[0] -split "`t|,")
 $hasHeader = $firstParts | Where-Object { $_.Trim().ToLowerInvariant() -in @('code','barcode','reference','amount','price','title') }
 $start = if ($hasHeader) { 1 } else { 0 }
 $headers = if ($hasHeader) {
  @($firstParts | ForEach-Object { $_.Trim().ToLowerInvariant() })
 } else {
  @('code','reference','amount','title')
 }
 for ($i = $start; $i -lt $lines.Count; $i++) {
  $parts = @($lines[$i] -split "`t|,")
  $map = @{}
  for ($j = 0; $j -lt $headers.Count -and $j -lt $parts.Count; $j++) {
   $key = $headers[$j]
   if ($key -eq 'barcode') { $key = 'code' }
   if ($key -eq 'price') { $key = 'amount' }
   $map[$key] = $parts[$j].Trim()
  }
  if (-not $map.ContainsKey('code') -or -not $map['code']) { continue }
  $rows.Add([pscustomobject]@{
   code = [string]$map['code']
   reference = if ($map.ContainsKey('reference')) { [string]$map['reference'] } else { '' }
   amount = if ($map.ContainsKey('amount')) { [string]$map['amount'] } else { '' }
   title = if ($map.ContainsKey('title') -and $map['title']) { [string]$map['title'] } else { 'VALID FOR 3 MONTHS ONLY' }
  })
 }
 if ($rows.Count -lt 1) { throw 'No usable rows found. Paste columns as code, reference, amount, title.' }
 $rows
}

function Save-PastedRows($Rows) {
 $Rows | Export-Csv -LiteralPath $PastedRowsPath -NoTypeInformation -Encoding UTF8
}

function Assert-SafeText($Text, $Name) {
 if ($Text -match '["\r\n]') { throw "$Name contains unsupported quote or newline characters." }
}

function Get-PrinterSummary($PrinterName) {
 $printer = Get-CimInstance Win32_Printer -Filter ("Name='{0}'" -f $PrinterName.Replace("'","''"))
 if (-not $printer) { return [pscustomobject]@{ Online=$false; Status='Missing'; Jobs=0; Port=''; Driver='' } }
 $jobs = @(Get-PrintJob -PrinterName $PrinterName -ErrorAction SilentlyContinue)
 [pscustomobject]@{
  Online = -not [bool]$printer.WorkOffline
  Status = if ($printer.WorkOffline) { 'Offline' } elseif ($printer.PrinterStatus -eq 3) { 'Ready' } else { "Status $($printer.PrinterStatus)" }
  Jobs = $jobs.Count
  Port = $printer.PortName
  Driver = $printer.DriverName
 }
}

function Build-Tspl($Rows, $Config, [switch]$UseSensorGap) {
 $rowsList = @($Rows)
 if ($rowsList.Count -lt 1) { throw 'No labels to print.' }
 if ($rowsList.Count -gt [int]$Config.maxBatch) { throw "Batch blocked: $($rowsList.Count) exceeds max batch $($Config.maxBatch)." }

 $height = if ($UseSensorGap) { [double]$Config.labelHeightMm } else { [double]$Config.pitchMm }
 $gap = if ($UseSensorGap) { [double]$Config.gapMm } else { 0 }
 $lines = [System.Collections.Generic.List[string]]::new()
 foreach ($line in @(
  ('SIZE {0} mm,{1} mm' -f $Config.labelWidthMm, $height),
  ('GAP {0} mm,0 mm' -f $gap),
  'DIRECTION 1',
  'REFERENCE 0,0',
  'SHIFT 0',
  'OFFSET 0 mm'
 )) { $lines.Add($line) }

 foreach ($row in $rowsList) {
  $code = ([string]$row.code).Trim()
  if ($code -notmatch '^[A-Za-z0-9\-\.\/\+\%\s]+$') { throw "Barcode has unsupported Code39 characters: $code" }
  $title = ([string]$row.title).Trim()
  $reference = ([string]$row.reference).Trim()
  $amount = ([string]$row.amount).Trim()
  Assert-SafeText $title 'Title'
  Assert-SafeText $reference 'Reference'
  Assert-SafeText $amount 'Amount'
  $lines.Add('CLS')
  $lines.Add(('TEXT {0},{1},"2",0,1,1,"{2}"' -f $Config.titleX,$Config.titleY,$title))
  $lines.Add(('BARCODE {0},{1},"39",{2},0,0,{3},{4},"{5}"' -f $Config.barcodeX,$Config.barcodeY,$Config.barcodeHeight,$Config.barcodeNarrow,$Config.barcodeWide,$code))
  $lines.Add(('TEXT {0},{1},"2",0,1,1,"{2}"' -f $Config.referenceX,$Config.referenceY,$reference))
  $lines.Add(('TEXT {0},{1},"2",0,1,1,"{2}"' -f $Config.amountX,$Config.amountY,$amount))
  $lines.Add('PRINT 1,1')
 }
 ($lines -join "`r`n") + "`r`n"
}

function Send-Labels($Rows, $Config, $JobName, [switch]$UseSensorGap) {
 $summary = Get-PrinterSummary $Config.printerName
 if (-not $summary.Online) { throw "Printer is not online: $($summary.Status)" }
 if ($summary.Jobs -gt 0) { throw "Queue is not empty ($($summary.Jobs) job/s). Clear or wait before retrying." }
 $payload = Build-Tspl -Rows $Rows -Config $Config -UseSensorGap:$UseSensorGap
 $jobId = [BulkLabelRawSpool]::Send($Config.printerName, $JobName, $payload)
 Add-History ([ordered]@{
  time = (Get-Date).ToString('s')
  jobId = $jobId
  printer = $Config.printerName
  count = @($Rows).Count
  mode = if ($UseSensorGap) { 'SensorGap' } else { 'ContinuousPitch' }
  widthMm = $Config.labelWidthMm
  heightMm = $Config.labelHeightMm
  pitchMm = $Config.pitchMm
  gapMm = $Config.gapMm
 })
 $jobId
}

function Send-Calibration($Config) {
 $summary = Get-PrinterSummary $Config.printerName
 if (-not $summary.Online) { throw "Printer is not online: $($summary.Status)" }
 if ($summary.Jobs -gt 0) { throw "Queue is not empty ($($summary.Jobs) job/s)." }
 $heightDots = [math]::Round(([double]$Config.labelHeightMm / 25.4) * 203)
 $gapDots = [math]::Max(1, [math]::Round(([double]$Config.gapMm / 25.4) * 203))
 $commands = @(
  ('SIZE {0} mm,{1} mm' -f $Config.labelWidthMm,$Config.labelHeightMm),
  ('GAP {0} mm,0 mm' -f $Config.gapMm),
  'DIRECTION 1',
  'REFERENCE 0,0',
  'SHIFT 0',
  'OFFSET 0 mm',
  ('GAPDETECT {0},{1}' -f $heightDots,$gapDots),
  'HOME'
 )
 $jobId = [BulkLabelRawSpool]::Send($Config.printerName, 'Bulk label media calibration', ($commands -join "`r`n") + "`r`n")
 Add-History ([ordered]@{
  time = (Get-Date).ToString('s')
  jobId = $jobId
  printer = $Config.printerName
  count = 0
  mode = 'Calibration'
  widthMm = $Config.labelWidthMm
  heightMm = $Config.labelHeightMm
  pitchMm = $Config.pitchMm
  gapMm = $Config.gapMm
 })
 $jobId
}

if ($NoGui) {
 $cfg = Load-Config
 $rows = Get-TemplateRows $cfg.xmlPath
 $id = Send-Labels -Rows $rows -Config $cfg -JobName 'Bulk label CLI test' -UseSensorGap:($cfg.mode -eq 'SensorGap')
 Write-Output "Submitted job $id"
 return
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$config = Load-Config

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Bulk Label Printing Dashboard'
$form.Width = 1120
$form.Height = 780
$form.MinimumSize = New-Object System.Drawing.Size(980,680)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.Color]::FromArgb(245,247,250)

$font = New-Object System.Drawing.Font('Segoe UI', 9)
$form.Font = $font

$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Dock = 'Fill'
$tabs.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$form.Controls.Add($tabs)

$header = New-Object System.Windows.Forms.Panel
$header.Dock = 'Top'
$header.Height = 78
$header.BackColor = [System.Drawing.Color]::FromArgb(25,42,70)
$form.Controls.Add($header)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = 'Bulk Label Printing'
$titleLabel.ForeColor = [System.Drawing.Color]::White
$titleLabel.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 18)
$titleLabel.Left = 22
$titleLabel.Top = 13
$titleLabel.Width = 360
$titleLabel.Height = 32
$header.Controls.Add($titleLabel)

$subtitleLabel = New-Object System.Windows.Forms.Label
$subtitleLabel.Text = 'Configure, paste, edit XML, save designs, and print Xprinter labels from one place.'
$subtitleLabel.ForeColor = [System.Drawing.Color]::FromArgb(215,225,240)
$subtitleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$subtitleLabel.Left = 24
$subtitleLabel.Top = 47
$subtitleLabel.Width = 720
$subtitleLabel.Height = 20
$header.Controls.Add($subtitleLabel)

$tabDashboard = New-Object System.Windows.Forms.TabPage('Dashboard')
$tabPaste = New-Object System.Windows.Forms.TabPage('Paste Rows')
$tabXmlEditor = New-Object System.Windows.Forms.TabPage('XML Editor')
$tabAssets = New-Object System.Windows.Forms.TabPage('Designs')
$tabSettings = New-Object System.Windows.Forms.TabPage('Settings')
$tabHistory = New-Object System.Windows.Forms.TabPage('Memory')
$tabs.TabPages.AddRange(@($tabDashboard,$tabPaste,$tabXmlEditor,$tabAssets,$tabSettings,$tabHistory))

function New-Label($Text,$X,$Y,$W=130) {
 $label = New-Object System.Windows.Forms.Label
 $label.Text = $Text
 $label.Left = $X
 $label.Top = $Y
 $label.Width = $W
 $label.Height = 24
 $label
}

function New-TextBox($Text,$X,$Y,$W=240) {
 $box = New-Object System.Windows.Forms.TextBox
 $box.Text = [string]$Text
 $box.Left = $X
 $box.Top = $Y
 $box.Width = $W
 $box
}

function Style-Button($Button, $Kind='Secondary') {
 $Button.Height = 32
 $Button.FlatStyle = 'Flat'
 $Button.FlatAppearance.BorderSize = 0
 $Button.Cursor = 'Hand'
 if ($Kind -eq 'Primary') {
  $Button.BackColor = [System.Drawing.Color]::FromArgb(28,112,216)
  $Button.ForeColor = [System.Drawing.Color]::White
 } elseif ($Kind -eq 'Danger') {
  $Button.BackColor = [System.Drawing.Color]::FromArgb(180,64,64)
  $Button.ForeColor = [System.Drawing.Color]::White
 } else {
  $Button.BackColor = [System.Drawing.Color]::FromArgb(229,235,244)
  $Button.ForeColor = [System.Drawing.Color]::FromArgb(25,42,70)
 }
}

$statusBox = New-Object System.Windows.Forms.TextBox
$statusBox.Multiline = $true
$statusBox.ScrollBars = 'Vertical'
$statusBox.Left = 20
$statusBox.Top = 20
$statusBox.Width = 870
$statusBox.Height = 160
$statusBox.ReadOnly = $true
$tabDashboard.Controls.Add($statusBox)

$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = 'Refresh Status'
$btnRefresh.Left = 20
$btnRefresh.Top = 195
$btnRefresh.Width = 130
$tabDashboard.Controls.Add($btnRefresh)

$btnCalibrate = New-Object System.Windows.Forms.Button
$btnCalibrate.Text = 'Calibrate Sensor'
$btnCalibrate.Left = 165
$btnCalibrate.Top = 195
$btnCalibrate.Width = 130
$tabDashboard.Controls.Add($btnCalibrate)

$tabDashboard.Controls.Add((New-Label 'Test copies' 20 245 90))
$copiesBox = New-Object System.Windows.Forms.NumericUpDown
$copiesBox.Left = 110
$copiesBox.Top = 242
$copiesBox.Width = 70
$copiesBox.Minimum = 1
$copiesBox.Maximum = 50
$copiesBox.Value = 5
$tabDashboard.Controls.Add($copiesBox)

$btnPrintXmlTest = New-Object System.Windows.Forms.Button
$btnPrintXmlTest.Text = 'Print XML Test'
$btnPrintXmlTest.Left = 200
$btnPrintXmlTest.Top = 240
$btnPrintXmlTest.Width = 130
$tabDashboard.Controls.Add($btnPrintXmlTest)

$btnPrintCsv = New-Object System.Windows.Forms.Button
$btnPrintCsv.Text = 'Bulk Print CSV'
$btnPrintCsv.Left = 345
$btnPrintCsv.Top = 240
$btnPrintCsv.Width = 130
$tabDashboard.Controls.Add($btnPrintCsv)

$btnOpenData = New-Object System.Windows.Forms.Button
$btnOpenData.Text = 'Open Data Folder'
$btnOpenData.Left = 490
$btnOpenData.Top = 240
$btnOpenData.Width = 130
$tabDashboard.Controls.Add($btnOpenData)

$previewBox = New-Object System.Windows.Forms.TextBox
$previewBox.Multiline = $true
$previewBox.ScrollBars = 'Both'
$previewBox.Left = 20
$previewBox.Top = 290
$previewBox.Width = 870
$previewBox.Height = 300
$previewBox.ReadOnly = $true
$tabDashboard.Controls.Add($previewBox)

$pasteBox = New-Object System.Windows.Forms.TextBox
$pasteBox.Multiline = $true
$pasteBox.ScrollBars = 'Both'
$pasteBox.AcceptsTab = $true
$pasteBox.Left = 20
$pasteBox.Top = 52
$pasteBox.Width = 870
$pasteBox.Height = 358
$pasteBox.Text = "code`treference`tamount`ttitle`r`n12345678`tCU10000 - 094`tKES 10,000/-`tVALID FOR 3 MONTHS ONLY"
$tabPaste.Controls.Add($pasteBox)

$pasteHelp = New-Object System.Windows.Forms.Label
$pasteHelp.Text = 'Paste copied rows here. Columns can be code/barcode, reference, amount/price, title. Preview before printing.'
$pasteHelp.Left = 20
$pasteHelp.Top = 20
$pasteHelp.Width = 870
$pasteHelp.Height = 22
$pasteHelp.ForeColor = [System.Drawing.Color]::FromArgb(70,80,95)
$tabPaste.Controls.Add($pasteHelp)

$btnLoadClipboardRows = New-Object System.Windows.Forms.Button
$btnLoadClipboardRows.Text = 'Paste Clipboard'
$btnLoadClipboardRows.Left = 20
$btnLoadClipboardRows.Top = 425
$btnLoadClipboardRows.Width = 130
$tabPaste.Controls.Add($btnLoadClipboardRows)

$btnPreviewPaste = New-Object System.Windows.Forms.Button
$btnPreviewPaste.Text = 'Preview Rows'
$btnPreviewPaste.Left = 165
$btnPreviewPaste.Top = 425
$btnPreviewPaste.Width = 130
$tabPaste.Controls.Add($btnPreviewPaste)

$btnSavePastedRows = New-Object System.Windows.Forms.Button
$btnSavePastedRows.Text = 'Save As CSV'
$btnSavePastedRows.Left = 310
$btnSavePastedRows.Top = 425
$btnSavePastedRows.Width = 130
$tabPaste.Controls.Add($btnSavePastedRows)

$btnPrintPastedRows = New-Object System.Windows.Forms.Button
$btnPrintPastedRows.Text = 'Print Pasted Rows'
$btnPrintPastedRows.Left = 455
$btnPrintPastedRows.Top = 425
$btnPrintPastedRows.Width = 145
$tabPaste.Controls.Add($btnPrintPastedRows)

$pastePreviewBox = New-Object System.Windows.Forms.TextBox
$pastePreviewBox.Multiline = $true
$pastePreviewBox.ScrollBars = 'Vertical'
$pastePreviewBox.Left = 20
$pastePreviewBox.Top = 470
$pastePreviewBox.Width = 870
$pastePreviewBox.Height = 120
$pastePreviewBox.ReadOnly = $true
$tabPaste.Controls.Add($pastePreviewBox)

$xmlEditorBox = New-Object System.Windows.Forms.TextBox
$xmlEditorBox.Multiline = $true
$xmlEditorBox.ScrollBars = 'Both'
$xmlEditorBox.AcceptsTab = $true
$xmlEditorBox.Left = 20
$xmlEditorBox.Top = 52
$xmlEditorBox.Width = 870
$xmlEditorBox.Height = 448
$xmlEditorBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$tabXmlEditor.Controls.Add($xmlEditorBox)

$xmlHelp = New-Object System.Windows.Forms.Label
$xmlHelp.Text = 'Edit the raw Label.labelxml template here. Use Save XML As when experimenting.'
$xmlHelp.Left = 20
$xmlHelp.Top = 20
$xmlHelp.Width = 870
$xmlHelp.Height = 22
$xmlHelp.ForeColor = [System.Drawing.Color]::FromArgb(70,80,95)
$tabXmlEditor.Controls.Add($xmlHelp)

$btnLoadXmlEditor = New-Object System.Windows.Forms.Button
$btnLoadXmlEditor.Text = 'Load XML'
$btnLoadXmlEditor.Left = 20
$btnLoadXmlEditor.Top = 515
$btnLoadXmlEditor.Width = 110
$tabXmlEditor.Controls.Add($btnLoadXmlEditor)

$btnValidateXmlEditor = New-Object System.Windows.Forms.Button
$btnValidateXmlEditor.Text = 'Validate'
$btnValidateXmlEditor.Left = 145
$btnValidateXmlEditor.Top = 515
$btnValidateXmlEditor.Width = 110
$tabXmlEditor.Controls.Add($btnValidateXmlEditor)

$btnSaveXmlEditor = New-Object System.Windows.Forms.Button
$btnSaveXmlEditor.Text = 'Save XML'
$btnSaveXmlEditor.Left = 270
$btnSaveXmlEditor.Top = 515
$btnSaveXmlEditor.Width = 110
$tabXmlEditor.Controls.Add($btnSaveXmlEditor)

$btnSaveXmlAsEditor = New-Object System.Windows.Forms.Button
$btnSaveXmlAsEditor.Text = 'Save XML As'
$btnSaveXmlAsEditor.Left = 395
$btnSaveXmlAsEditor.Top = 515
$btnSaveXmlAsEditor.Width = 120
$tabXmlEditor.Controls.Add($btnSaveXmlAsEditor)

$xmlStatusBox = New-Object System.Windows.Forms.TextBox
$xmlStatusBox.Multiline = $true
$xmlStatusBox.Left = 535
$xmlStatusBox.Top = 515
$xmlStatusBox.Width = 355
$xmlStatusBox.Height = 70
$xmlStatusBox.ReadOnly = $true
$tabXmlEditor.Controls.Add($xmlStatusBox)

$assetList = New-Object System.Windows.Forms.ListBox
$assetList.Left = 20
$assetList.Top = 52
$assetList.Width = 410
$assetList.Height = 448
$tabAssets.Controls.Add($assetList)

$assetHelp = New-Object System.Windows.Forms.Label
$assetHelp.Text = 'Save screenshots, label designs, logo references, and prize/image ideas into local memory.'
$assetHelp.Left = 20
$assetHelp.Top = 20
$assetHelp.Width = 870
$assetHelp.Height = 22
$assetHelp.ForeColor = [System.Drawing.Color]::FromArgb(70,80,95)
$tabAssets.Controls.Add($assetHelp)

$assetPreview = New-Object System.Windows.Forms.PictureBox
$assetPreview.Left = 455
$assetPreview.Top = 20
$assetPreview.Width = 435
$assetPreview.Height = 360
$assetPreview.SizeMode = 'Zoom'
$assetPreview.BorderStyle = 'FixedSingle'
$tabAssets.Controls.Add($assetPreview)

$assetNoteBox = New-Object System.Windows.Forms.TextBox
$assetNoteBox.Multiline = $true
$assetNoteBox.Left = 455
$assetNoteBox.Top = 395
$assetNoteBox.Width = 435
$assetNoteBox.Height = 105
$assetNoteBox.Text = 'Saved designs/images live in data\assets. They are stored as design references; barcode/text printing remains TSPL-based for accurate bulk output.'
$tabAssets.Controls.Add($assetNoteBox)

$btnPasteImage = New-Object System.Windows.Forms.Button
$btnPasteImage.Text = 'Paste Image'
$btnPasteImage.Left = 20
$btnPasteImage.Top = 515
$btnPasteImage.Width = 110
$tabAssets.Controls.Add($btnPasteImage)

$btnImportImage = New-Object System.Windows.Forms.Button
$btnImportImage.Text = 'Import Image'
$btnImportImage.Left = 145
$btnImportImage.Top = 515
$btnImportImage.Width = 110
$tabAssets.Controls.Add($btnImportImage)

$btnRefreshAssets = New-Object System.Windows.Forms.Button
$btnRefreshAssets.Text = 'Refresh Designs'
$btnRefreshAssets.Left = 270
$btnRefreshAssets.Top = 515
$btnRefreshAssets.Width = 130
$tabAssets.Controls.Add($btnRefreshAssets)

$fields = @{}
$settingRows = @(
 @('Printer','printerName',20,20,300),
 @('XML template','xmlPath',20,55,620),
 @('CSV file','csvPath',20,90,620),
 @('Width mm','labelWidthMm',20,135,100),
 @('Label height mm','labelHeightMm',230,135,100),
 @('Pitch mm','pitchMm',470,135,100),
 @('Gap mm','gapMm',680,135,100),
 @('Title X','titleX',20,190,80),
 @('Title Y','titleY',160,190,80),
 @('Barcode X','barcodeX',300,190,80),
 @('Barcode Y','barcodeY',440,190,80),
 @('Barcode height','barcodeHeight',580,190,80),
 @('Reference X','referenceX',20,245,80),
 @('Reference Y','referenceY',160,245,80),
 @('Amount X','amountX',300,245,80),
 @('Amount Y','amountY',440,245,80),
 @('Max batch','maxBatch',580,245,80)
)
foreach ($row in $settingRows) {
 $tabSettings.Controls.Add((New-Label $row[0] $row[2] $row[3] 120))
 $box = New-TextBox $config.($row[1]) ($row[2] + 120) $row[3] $row[4]
 $tabSettings.Controls.Add($box)
 $fields[$row[1]] = $box
}

$tabSettings.Controls.Add((New-Label 'Feed mode' 20 305 120))
$modeBox = New-Object System.Windows.Forms.ComboBox
$modeBox.Left = 140
$modeBox.Top = 302
$modeBox.Width = 180
$modeBox.DropDownStyle = 'DropDownList'
[void]$modeBox.Items.Add('ContinuousPitch')
[void]$modeBox.Items.Add('SensorGap')
$modeBox.SelectedItem = [string]$config.mode
$tabSettings.Controls.Add($modeBox)

$btnSave = New-Object System.Windows.Forms.Button
$btnSave.Text = 'Save Settings'
$btnSave.Left = 20
$btnSave.Top = 360
$btnSave.Width = 130
$tabSettings.Controls.Add($btnSave)

$btnBrowseXml = New-Object System.Windows.Forms.Button
$btnBrowseXml.Text = 'Browse XML'
$btnBrowseXml.Left = 770
$btnBrowseXml.Top = 53
$btnBrowseXml.Width = 100
$tabSettings.Controls.Add($btnBrowseXml)

$btnBrowseCsv = New-Object System.Windows.Forms.Button
$btnBrowseCsv.Text = 'Browse CSV'
$btnBrowseCsv.Left = 770
$btnBrowseCsv.Top = 88
$btnBrowseCsv.Width = 100
$tabSettings.Controls.Add($btnBrowseCsv)

$historyBox = New-Object System.Windows.Forms.TextBox
$historyBox.Multiline = $true
$historyBox.ScrollBars = 'Vertical'
$historyBox.Left = 20
$historyBox.Top = 20
$historyBox.Width = 870
$historyBox.Height = 560
$historyBox.ReadOnly = $true
$tabHistory.Controls.Add($historyBox)

function Read-ConfigFromForm {
 $cfg = [ordered]@{}
 foreach ($key in $fields.Keys) {
  $value = $fields[$key].Text
  if ($key -in @('labelWidthMm','labelHeightMm','pitchMm','gapMm')) { $value = [double]$value }
  if ($key -notin @('printerName','xmlPath','csvPath','labelWidthMm','labelHeightMm','pitchMm','gapMm','mode')) {
   $value = [int]$value
  }
  $cfg[$key] = $value
 }
 $cfg['mode'] = [string]$modeBox.SelectedItem
 [pscustomobject]$cfg
}

function Refresh-History {
 $items = @(Get-RecentHistory)
 $historyBox.Text = if ($items.Count) {
  ($items | ForEach-Object {
   '{0}  job={1}  mode={2}  labels={3}  pitch={4}  gap={5}' -f $_.time,$_.jobId,$_.mode,$_.count,$_.pitchMm,$_.gapMm
  }) -join [Environment]::NewLine
 } else {
  'No print history yet.'
 }
}

function Refresh-Assets {
 $assetList.Items.Clear()
 Get-ChildItem -LiteralPath $AssetsDir -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension.ToLowerInvariant() -in @('.png','.jpg','.jpeg','.bmp','.gif') } |
  Sort-Object LastWriteTime -Descending |
  ForEach-Object { [void]$assetList.Items.Add($_.FullName) }
}

function Preview-PastedRows {
 $rows = @(Convert-PastedTextToRows $pasteBox.Text)
 $pastePreviewBox.Text = @(
  "Rows ready: $($rows.Count)",
  "First row:",
  "Code: $($rows[0].code)",
  "Reference: $($rows[0].reference)",
  "Amount/Price: $($rows[0].amount)",
  "Title: $($rows[0].title)"
 ) -join [Environment]::NewLine
 $rows
}

function Refresh-Dashboard {
 try {
  $script:config = Read-ConfigFromForm
  $summary = Get-PrinterSummary $script:config.printerName
  $rows = @(Get-TemplateRows $script:config.xmlPath)
  $statusBox.Text = @(
   "Printer: $($script:config.printerName)",
   "Status: $($summary.Status), Queue: $($summary.Jobs), Port: $($summary.Port), Driver: $($summary.Driver)",
   "Mode: $($script:config.mode)",
   "Label: $($script:config.labelWidthMm) mm x $($script:config.labelHeightMm) mm, Pitch: $($script:config.pitchMm) mm, Gap: $($script:config.gapMm) mm",
   "XML: $($script:config.xmlPath)",
   "CSV: $($script:config.csvPath)"
  ) -join [Environment]::NewLine
  $previewBox.Text = "Template preview:`r`nCode: $($rows[0].code)`r`nTitle: $($rows[0].title)`r`nReference: $($rows[0].reference)`r`nAmount: $($rows[0].amount)"
 } catch {
  $statusBox.Text = "Problem: $($_.Exception.Message)"
 }
 Refresh-History
}

function Browse-File($Filter, $TargetBox) {
 $dialog = New-Object System.Windows.Forms.OpenFileDialog
 $dialog.Filter = $Filter
 if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  $TargetBox.Text = $dialog.FileName
 }
}

function Load-XmlEditor {
 $cfg = Read-ConfigFromForm
 if (-not (Test-Path -LiteralPath $cfg.xmlPath)) { throw "XML template not found: $($cfg.xmlPath)" }
 $xmlEditorBox.Text = Get-Content -Raw -LiteralPath $cfg.xmlPath
 $xmlStatusBox.Text = "Loaded $($cfg.xmlPath)"
}

function Validate-XmlEditor {
 [xml]$xml = $xmlEditorBox.Text
 $shapes = $xml.BarcodeNLabel.FixedPage.ShapeList.XShape
 if (-not $shapes) { throw 'XML loaded, but expected BarcodeNLabel/FixedPage/ShapeList/XShape was not found.' }
 $texts = @($shapes | Where-Object ShapeType -eq 'XText')
 $barcodes = @($shapes | Where-Object ShapeType -eq 'XBarcode')
 $xmlStatusBox.Text = "Valid XML. Text fields: $($texts.Count). Barcodes: $($barcodes.Count)."
}

function Save-XmlEditor($SaveAs) {
 Validate-XmlEditor
 $cfg = Read-ConfigFromForm
 $target = $cfg.xmlPath
 if ($SaveAs) {
  $dialog = New-Object System.Windows.Forms.SaveFileDialog
  $dialog.Filter = 'Label XML (*.labelxml;*.xml)|*.labelxml;*.xml|All files (*.*)|*.*'
  $dialog.FileName = 'Label-edited.labelxml'
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
  $target = $dialog.FileName
  $fields['xmlPath'].Text = $target
 }
 $xmlEditorBox.Text | Set-Content -LiteralPath $target -Encoding UTF8
 $xmlStatusBox.Text = "Saved $target"
}

$btnRefresh.Add_Click({ Refresh-Dashboard })
$btnLoadClipboardRows.Add_Click({
 try {
  if ([System.Windows.Forms.Clipboard]::ContainsText()) {
   $pasteBox.Text = [System.Windows.Forms.Clipboard]::GetText()
   Preview-PastedRows | Out-Null
  } else {
   [System.Windows.Forms.MessageBox]::Show('Clipboard does not contain text rows.','Nothing to paste') | Out-Null
  }
 } catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Paste failed') | Out-Null
 }
})
$btnPreviewPaste.Add_Click({
 try { Preview-PastedRows | Out-Null } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Preview failed') | Out-Null }
})
$btnSavePastedRows.Add_Click({
 try {
  $rows = @(Preview-PastedRows)
  Save-PastedRows $rows
  $fields['csvPath'].Text = $PastedRowsPath
  $pastePreviewBox.Text += [Environment]::NewLine + "Saved to $PastedRowsPath"
 } catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Save rows failed') | Out-Null
 }
})
$btnPrintPastedRows.Add_Click({
 try {
  $script:config = Read-ConfigFromForm
  Save-Config $script:config
  $rows = @(Preview-PastedRows)
  $confirm = [System.Windows.Forms.MessageBox]::Show("Print $($rows.Count) pasted labels?",'Confirm pasted print','YesNo')
  if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
  $id = Send-Labels -Rows $rows -Config $script:config -JobName 'Bulk label pasted rows' -UseSensorGap:($script:config.mode -eq 'SensorGap')
  Refresh-Dashboard
  [System.Windows.Forms.MessageBox]::Show("Pasted-row job $id submitted with $($rows.Count) labels.",'Print sent') | Out-Null
 } catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Pasted print failed') | Out-Null
 }
})
$btnLoadXmlEditor.Add_Click({ try { Load-XmlEditor } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Load XML failed') | Out-Null } })
$btnValidateXmlEditor.Add_Click({ try { Validate-XmlEditor } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'XML invalid') | Out-Null } })
$btnSaveXmlEditor.Add_Click({ try { Save-XmlEditor $false } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Save XML failed') | Out-Null } })
$btnSaveXmlAsEditor.Add_Click({ try { Save-XmlEditor $true } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Save XML failed') | Out-Null } })
$btnRefreshAssets.Add_Click({ Refresh-Assets })
$assetList.Add_SelectedIndexChanged({
 try {
  if ($assetList.SelectedItem) {
   if ($assetPreview.Image) { $assetPreview.Image.Dispose(); $assetPreview.Image = $null }
   $assetPreview.Image = [System.Drawing.Image]::FromFile([string]$assetList.SelectedItem)
  }
 } catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Preview failed') | Out-Null
 }
})
$btnPasteImage.Add_Click({
 try {
  if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
   [System.Windows.Forms.MessageBox]::Show('Clipboard does not contain an image.','Nothing to paste') | Out-Null
   return
  }
  $image = [System.Windows.Forms.Clipboard]::GetImage()
  $path = Join-Path $AssetsDir ("design-{0}.png" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $image.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  Refresh-Assets
  $assetList.SelectedItem = $path
 } catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Paste image failed') | Out-Null
 }
})
$btnImportImage.Add_Click({
 try {
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Filter = 'Images (*.png;*.jpg;*.jpeg;*.bmp;*.gif)|*.png;*.jpg;*.jpeg;*.bmp;*.gif|All files (*.*)|*.*'
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }
  $dest = Join-Path $AssetsDir ([IO.Path]::GetFileName($dialog.FileName))
  Copy-Item -LiteralPath $dialog.FileName -Destination $dest -Force
  Refresh-Assets
  $assetList.SelectedItem = $dest
 } catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Import image failed') | Out-Null
 }
})
$btnSave.Add_Click({
 try {
  $script:config = Read-ConfigFromForm
  Save-Config $script:config
  Refresh-Dashboard
  [System.Windows.Forms.MessageBox]::Show('Settings saved to internal memory.','Saved') | Out-Null
 } catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Save failed') | Out-Null
 }
})
$btnBrowseXml.Add_Click({ Browse-File 'Label XML (*.labelxml;*.xml)|*.labelxml;*.xml|All files (*.*)|*.*' $fields['xmlPath'] })
$btnBrowseCsv.Add_Click({ Browse-File 'CSV files (*.csv)|*.csv|All files (*.*)|*.*' $fields['csvPath'] })
$btnOpenData.Add_Click({ Start-Process explorer.exe $DataDir })
$btnCalibrate.Add_Click({
 try {
  $script:config = Read-ConfigFromForm
  Save-Config $script:config
  $id = Send-Calibration $script:config
  Refresh-Dashboard
  [System.Windows.Forms.MessageBox]::Show("Calibration job $id submitted. The printer may feed blank labels.",'Calibration sent') | Out-Null
 } catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Calibration failed') | Out-Null
 }
})
$btnPrintXmlTest.Add_Click({
 try {
  $script:config = Read-ConfigFromForm
  Save-Config $script:config
  $baseRows = @(Get-TemplateRows $script:config.xmlPath)
  $rows = for ($i = 1; $i -le [int]$copiesBox.Value; $i++) { $baseRows[0] }
  $id = Send-Labels -Rows $rows -Config $script:config -JobName 'Bulk label XML test' -UseSensorGap:($script:config.mode -eq 'SensorGap')
  Refresh-Dashboard
  [System.Windows.Forms.MessageBox]::Show("XML test job $id submitted with $($rows.Count) labels.",'Print sent') | Out-Null
 } catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Print failed') | Out-Null
 }
})
$btnPrintCsv.Add_Click({
 try {
  $script:config = Read-ConfigFromForm
  Save-Config $script:config
  $rows = @(Get-CsvRows $script:config.csvPath)
  $confirm = [System.Windows.Forms.MessageBox]::Show("Print $($rows.Count) labels from CSV?",'Confirm bulk print','YesNo')
  if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
  $id = Send-Labels -Rows $rows -Config $script:config -JobName 'Bulk label CSV batch' -UseSensorGap:($script:config.mode -eq 'SensorGap')
  Refresh-Dashboard
  [System.Windows.Forms.MessageBox]::Show("Bulk job $id submitted with $($rows.Count) labels.",'Print sent') | Out-Null
 } catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'Bulk print failed') | Out-Null
 }
})

@(
 $btnRefresh,
 $btnCalibrate,
 $btnOpenData,
 $btnLoadClipboardRows,
 $btnPreviewPaste,
 $btnSavePastedRows,
 $btnLoadXmlEditor,
 $btnValidateXmlEditor,
 $btnSaveXmlEditor,
 $btnSaveXmlAsEditor,
 $btnPasteImage,
 $btnImportImage,
 $btnRefreshAssets,
 $btnSave,
 $btnBrowseXml,
 $btnBrowseCsv
) | ForEach-Object { Style-Button $_ 'Secondary' }

@(
 $btnPrintXmlTest,
 $btnPrintCsv,
 $btnPrintPastedRows
) | ForEach-Object { Style-Button $_ 'Primary' }

Refresh-Dashboard
Refresh-Assets
try { Load-XmlEditor } catch { $xmlStatusBox.Text = $_.Exception.Message }
[void]$form.ShowDialog()
