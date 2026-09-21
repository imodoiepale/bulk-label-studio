param(
 [Parameter(Mandatory=$true)][string]$PrinterName,
 [Parameter(Mandatory=$true)][string]$PayloadPath,
 [string]$JobName = 'Bulk Label Studio'
)

$ErrorActionPreference = 'Stop'

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
 public static int Send(string printerName,string jobName,string text) {
  IntPtr h; if(!OpenPrinter(printerName,out h,IntPtr.Zero)) throw new Win32Exception();
  try {
   Doc doc = new Doc(); doc.name = jobName;
   int id=StartDocPrinter(h,1,doc); if(id==0) throw new Win32Exception();
   byte[] bytes=System.Text.Encoding.ASCII.GetBytes(text); int written;
   if(!WritePrinter(h,bytes,bytes.Length,out written) || written!=bytes.Length) throw new Exception("Write incomplete; inspect queue before retrying.");
   if(!EndDocPrinter(h)) throw new Win32Exception();
   return id;
  } finally { ClosePrinter(h); }
 }
}
'@

$printer = Get-CimInstance Win32_Printer -Filter ("Name='{0}'" -f $PrinterName.Replace("'","''"))
if (-not $printer) { throw "Printer not found: $PrinterName" }
if ($printer.WorkOffline) { throw "Printer offline: $PrinterName" }
if (@(Get-PrintJob -PrinterName $PrinterName -ErrorAction SilentlyContinue).Count) { throw 'Queue is not empty; clear or wait before retrying.' }

$payload = Get-Content -Raw -LiteralPath $PayloadPath
$jobId = [BulkLabelRawSpool]::Send($PrinterName, $JobName, $payload)
Write-Output $jobId

