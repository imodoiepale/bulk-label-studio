# Prints the 5 rows in random_test.csv on the measured stock (63.5 x 38.1 mm, 3 mm gap)
# using the same TSPL layout and RAW spooler path as Bulk Label Studio.
param(
 [string]$PrinterName = 'Xprinter XP-370B',
 [string]$CsvPath = "$PSScriptRoot\random_test.csv"
)
$ErrorActionPreference = 'Stop'

$rows = Import-Csv -LiteralPath $CsvPath
$lines = @(
 'SIZE 63.5 mm,38.1 mm',
 'GAP 3 mm,0 mm',
 'DIRECTION 1',
 'REFERENCE 0,0',
 'SHIFT 0',
 'OFFSET 0 mm'
)
foreach ($r in $rows) {
 $lines += 'CLS'
 $lines += ('TEXT 72,24,"2",0,1,1,"{0}"' -f $r.title)
 $lines += ('BARCODE 78,64,"39",72,0,0,2,4,"{0}"' -f $r.code)
 $lines += ('TEXT 180,148,"2",0,1,1,"{0}"' -f $r.reference)
 $lines += ('TEXT 196,178,"2",0,1,1,"{0}"' -f $r.amount)
 $lines += ('TEXT 200,208,"2",0,1,1,"{0}"' -f $r.code)
 $lines += 'PRINT 1,1'
}
$payload = Join-Path $env:TEMP "bulk-label-random-test.txt"
[IO.File]::WriteAllText($payload, (($lines -join "`r`n") + "`r`n"), [Text.Encoding]::ASCII)

$jobId = & "$PSScriptRoot\tools\print-raw.ps1" -PrinterName $PrinterName -PayloadPath $payload -JobName 'Random calibration labels'
Write-Output "Sent $($rows.Count) labels to $PrinterName (job $jobId)"
