param([string[]]$Gaps = @('3','5','12.7'))
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public class GapTestSpool {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public class Doc { public string name="Three gap tests"; public string file=null; public string type="RAW"; }
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool OpenPrinter(string name,out IntPtr h,IntPtr defaults);
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern int StartDocPrinter(IntPtr h,int level,Doc doc);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr h,byte[] data,int count,out int written);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
 [DllImport("winspool.drv")] static extern bool ClosePrinter(IntPtr h);
 public static int Send(string name,string text) {
  IntPtr h; if(!OpenPrinter(name,out h,IntPtr.Zero)) throw new Win32Exception();
  try { int id=StartDocPrinter(h,1,new Doc()); if(id==0) throw new Win32Exception();
   byte[] bytes=System.Text.Encoding.ASCII.GetBytes(text); int written;
   if(!WritePrinter(h,bytes,bytes.Length,out written) || written!=bytes.Length) throw new Exception("Write incomplete; do not retry without checking queue");
   if(!EndDocPrinter(h)) throw new Win32Exception(); return id;
  } finally { ClosePrinter(h); }
 }
}
'@
$printer = Get-CimInstance Win32_Printer -Filter "Name='Xprinter XP-370B'"
if ($printer.WorkOffline) { throw 'Printer offline' }
if (@(Get-PrintJob -PrinterName $printer.Name).Count) { throw 'Queue is not empty; inspect before retrying' }
[xml]$xml = Get-Content -Raw -LiteralPath 'C:\Users\itsupport\Downloads\Label.labelxml'
$shapes = $xml.BarcodeNLabel.FixedPage.ShapeList.XShape
$texts = @($shapes | Where-Object ShapeType -eq 'XText' | Sort-Object { [double]$_.y })
$code = ($shapes | Where-Object ShapeType -eq 'XBarcode').TextValue.Trim()
if ($code -notmatch '^\d+$') { throw 'Unexpected barcode data' }
$lines = [System.Collections.Generic.List[string]]::new()
$i = 0
foreach ($gap in $Gaps) {
 if ($gap -notin @('3','5','12.7')) { throw 'Unsupported gap' }
 $i++
 foreach ($line in @('SIZE 63.5 mm,38.1 mm',("GAP {0} mm,0 mm" -f $gap),'DIRECTION 1','REFERENCE 0,0','SHIFT 0','OFFSET 0 mm','CLS',('TEXT 20,16,"2",0,1,1,"TEST {0} - GAP {1} mm"' -f $i,$gap),'BAR 20,43,460,2')) { $lines.Add($line) }
 $title = $texts[0].TextValue.Trim()
 $ref = $texts[1].TextValue.Trim()
 $amount = $texts[2].TextValue.Trim()
 foreach ($t in @($title,$ref,$amount)) { if ($t -match '["\r\n]') { throw 'Unexpected text characters' } }
 $lines.Add(('TEXT 20,62,"2",0,1,1,"{0}"' -f $title))
 $lines.Add(('BARCODE 50,98,"39",70,0,0,2,4,"{0}"' -f $code))
 $lines.Add(('TEXT 125,184,"2",0,1,1,"{0}"' -f $ref))
 $lines.Add(('TEXT 145,213,"2",0,1,1,"{0}"' -f $amount))
 $lines.Add('BAR 20,275,460,2')
 $lines.Add('PRINT 1,1')
}
$job = [GapTestSpool]::Send($printer.Name, ($lines -join "`r`n") + "`r`n")
Write-Output "Submitted job $job with $($Gaps.Count) numbered tests. Gaps in mm: $($Gaps -join ', ')."
