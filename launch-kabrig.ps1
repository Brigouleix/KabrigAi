# Lanceur Kabrig : démarre Ollama si besoin puis lance l'application.
# Le backend (uvicorn) est démarré ET arrêté par l'application elle-même.
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $root "frontend\src-tauri\target\release\app.exe"

# Ollama (le serveur LLM local) — le démarre s'il ne tourne pas.
if (-not (Get-Process ollama -ErrorAction SilentlyContinue)) {
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

# Lance l'application (qui démarre le backend en interne et le coupe en sortant).
if (Test-Path $exe) {
    Start-Process -FilePath $exe
} else {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("L'application n'est pas compilée.`nLance : npx tauri build", "Kabrig") | Out-Null
}
