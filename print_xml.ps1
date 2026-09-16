$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
[xml]$source = Get-Content -Raw -LiteralPath 'C:\Users\itsupport\Downloads\Label.labelxml'
$script:shapes = @($source.BarcodeNLabel.FixedPage.ShapeList.XShape)
$script:page = 0
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = 'Xprinter XP-370B'
if (-not $doc.PrinterSettings.IsValid) { throw 'Printer unavailable' }
$doc.DocumentName = 'Label.labelxml - 5 copies'
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$doc.add_PrintPage({
 param($sender,$e)
 $g = $e.Graphics
 $g.PageUnit = [System.Drawing.GraphicsUnit]::Display
 $area = $e.PageSettings.PrintableArea
 $width = [Math]::Min(220, $area.Width - 16)
 if ($width -lt 100) { throw 'Printable area too small' }
 $x = 8.0; $y = 8.0
 $f = New-Object System.Drawing.Font('Arial',10,[System.Drawing.FontStyle]::Bold)
 $fmt = New-Object System.Drawing.StringFormat
 $fmt.Alignment = [System.Drawing.StringAlignment]::Center
 try {
  $texts = @($script:shapes | Where-Object ShapeType -eq 'XText' | Sort-Object { [double]$_.y })
  $g.DrawString($texts[0].TextValue.Trim(),$f,[System.Drawing.Brushes]::Black,[System.Drawing.RectangleF]::new($x,$y,$width,22),$fmt)
  $bc = $script:shapes | Where-Object ShapeType -eq 'XBarcode'
  $value = $bc.TextValue.Trim('*').Trim()
  $patterns = @{'0'='nnnwwnwnn';'1'='wnnwnnnnw';'2'='nnwwnnnnw';'3'='wnwwnnnnn';'4'='nnnwwnnnw';'5'='wnnwwnnnn';'6'='nnwwwnnnn';'7'='nnnwnnwnw';'8'='wnnwnnwnn';'9'='nnwwnnwnn';'*'='nwnnwnwnn'}
  $encoded = '*' + $value + '*'
  $units = $encoded.Length * 13 - 1 + 20
  $module = $width / $units
  $bx = $x + 10*$module
  foreach($ch in $encoded.ToCharArray()) {
   $pat = $patterns[[string]$ch]
   if (-not $pat) { throw 'Unsupported barcode character' }
   for($i=0;$i -lt 9;$i++) {
    $bw = $module
    if ($pat[$i] -eq 'w') { $bw *= 2 }
    if ($i % 2 -eq 0) { $g.FillRectangle([System.Drawing.Brushes]::Black,[single]$bx,[single]($y+25),[single]$bw,[single]45) }
    $bx += $bw
   }
   $bx += $module
  }
  $g.DrawString($texts[1].TextValue.Trim(),$f,[System.Drawing.Brushes]::Black,[System.Drawing.RectangleF]::new($x,$y+74,$width,20),$fmt)
  $g.DrawString($texts[2].TextValue.Trim(),$f,[System.Drawing.Brushes]::Black,[System.Drawing.RectangleF]::new($x,$y+94,$width,20),$fmt)
 } finally { $f.Dispose(); $fmt.Dispose() }
 $script:page++
 $e.HasMorePages = $script:page -lt 5
})
try {
 Write-Output ('Driver page: ' + $doc.DefaultPageSettings.PaperSize.ToString())
 $doc.Print()
 Write-Output 'Submitted five XML-based labels through Windows driver. Physical output requires verification.'
} finally { $doc.Dispose() }
