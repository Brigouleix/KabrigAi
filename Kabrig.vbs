' Lance le script PowerShell de démarrage Kabrig SANS fenêtre console visible.
Set sh = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "launch-kabrig.ps1""", 0, False
