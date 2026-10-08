"""Uruchamia makro VBA dokumentu w LibreOffice (headless, UNO) i zapisuje dokument jako XLSX/ODS do odczytu wyników."""
import sys, os, time, subprocess, uno
from com.sun.star.beans import PropertyValue
def P(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p
doc_path, macro, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
port = 2002 + os.getpid() % 1000
proc = subprocess.Popen(["soffice", "--headless", "--invisible", "--norestore", "--nologo",
    f"--accept=socket,host=localhost,port={port};urp;", "-env:UserInstallation=file:///tmp/lo_profile_%d" % port],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ctx = None
for _ in range(60):
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        ctx = resolver.resolve(f"uno:socket,host=localhost,port={port};urp;StarOffice.ComponentContext"); break
    except Exception:
        time.sleep(1)
smgr = ctx.ServiceManager
desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)
doc = desktop.loadComponentFromURL(uno.systemPathToFileUrl(os.path.abspath(doc_path)), "_blank", 0,
    (P("Hidden", False), P("MacroExecutionMode", 4)))
rc = 0
try:
    sp = doc.getScriptProvider()
    script = sp.getScript(f"vnd.sun.star.script:{macro}?language=Basic&location=document")
    res = script.invoke((), (), ())
    print("WYNIK:", res[0])
except Exception as e:
    print("BLAD MAKRA:", e); rc = 1
filt = "Calc MS Excel 2007 XML" if out_path.endswith(".xlsx") else "calc8"
doc.storeToURL(uno.systemPathToFileUrl(os.path.abspath(out_path)), (P("FilterName", filt),))
doc.close(True)
try: desktop.terminate()
except Exception: pass
proc.wait(timeout=30)
sys.exit(rc)
