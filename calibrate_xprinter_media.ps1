$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public class MediaCalSpool {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public class Doc { public string name="Xprinter media calibration"; public string file=null; public string type="RAW"; }
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool OpenPrinter(string name,out IntPtr h,IntPtr defaults);
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)] static extern int StartDocPrinter(IntPtr h,int level,Doc doc);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr h,byte[] data,int count,out int written);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
 [DllImport("winspool.drv")] static extern bool ClosePrinter(IntPtr h);
 public static int Send(string name,string text) {
  IntPtr h; if(!OpenPrinter(name,out h,IntPtr.Zero)) throw new Win32Exception();
  try {
   int id=StartDocPrinter(h,1,new Doc()); if(id==0) throw new Win32Exception();
   byte[] bytes=System.Text.Encoding.ASCII.GetBytes(text); int written;
   if(!WritePrinter(h,bytes,bytes.Length,out written) || written!=bytes.Length) throw new Exception("Write incomplete; do not retry without checking queue");
   if(!EndDocPrinter(h)) throw new Win32Exception();
   return id;
  } finally { ClosePrinter(h); }
 }
}
'@

$printer = Get-CimInstance Win32_Printer -Filter "Name='Xprinter XP-370B'"
if (-not $printer) { throw 'Xprinter XP-370B was not found.' }
if ($printer.WorkOffline) { throw 'Printer offline.' }
if (@(Get-PrintJob -PrinterName $printer.Name).Count) { throw 'Queue is not empty; inspect before retrying.' }

$commands = @(
 'SIZE 63.5 mm,38.1 mm',
 'GAP 3 mm,0 mm',
 'DIRECTION 1',
 'REFERENCE 0,0',
 'SHIFT 0',
 'OFFSET 0 mm',
 'GAPDETECT 305,24',
 'HOME'
)

$job = [MediaCalSpool]::Send($printer.Name, ($commands -join "`r`n") + "`r`n")
Write-Output "Submitted media calibration job $job."
