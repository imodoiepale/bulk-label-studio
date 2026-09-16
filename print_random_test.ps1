$printer = 'Xprinter XP-370B'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int StartDocPrinter(IntPtr h,int l,[In] DOCINFO d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, IntPtr b, int n, out int w);
  public static void Send(string printer,string data) { IntPtr h; if(!OpenPrinter(printer,out h,IntPtr.Zero)) throw new Exception("OpenPrinter failed: "+Marshal.GetLastWin32Error()); var d=new DOCINFO(); d.pDocName="Random calibration labels"; d.pDataType="RAW"; StartDocPrinter(h,1,d); StartPagePrinter(h); byte[] b=System.Text.Encoding.ASCII.GetBytes(data); IntPtr p=Marshal.AllocHGlobal(b.Length); Marshal.Copy(b,0,p,b.Length); int w; WritePrinter(h,p,b.Length,out w); Marshal.FreeHGlobal(p); EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h); }
}
"@
$codes = 'R482731','R159604','R806215','R374928','R691503'
$tspl = "SIZE 75 mm,32 mm`r`nGAP 2 mm,0 mm`r`nDIRECTION 1`r`nCLS`r`n"
foreach($c in $codes){
  $tspl += 'TEXT 260,35,"3",0,1,1,"VALID FOR 3 MONTHS ONLY"' + "`r`n"
  $tspl += ('BARCODE 170,75,"128",70,1,0,2,2,"' + $c + '"' + "`r`n")
  $tspl += ('TEXT 245,155,"3",0,1,1,"' + $c + '"' + "`r`n")
  $tspl += 'TEXT 250,195,"3",0,1,1,"CU10000 - 094"' + "`r`n"
  $tspl += 'TEXT 270,235,"3",0,1,1,"KES 10,000/-"' + "`r`n"
  $tspl += "PRINT 1,1`r`n"
}
[RawPrinter]::Send($printer,$tspl)
Write-Output "Sent 5 random calibration labels to $printer"
