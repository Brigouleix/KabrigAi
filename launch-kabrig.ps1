# Lanceur Kabrig : démarre le backend (+ Ollama si besoin), attend qu'il
# réponde, lance l'application, puis arrête le backend à la fermeture.
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$python = Join-Path $backend ".venv\Scripts\python.exe"
$exe = Join-Path $root "frontend\src-tauri\target\release\app.exe"

function Test-Backend {
    try { Invoke-WebRequest "http://localhost:8000/api/health" -UseBasicParsing -TimeoutSec 1 | Out-Null; return $true }
    catch { return $false }
}

# 1. Ollama (le serveur LLM local) — le démarre s'il ne tourne pas.
if (-not (Get-Process ollama -ErrorAction SilentlyContinue)) {
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

# 2. Backend — démarre uvicorn caché si l'API ne répond pas déjà.
$beProc = $null
if (-not (Test-Backend)) {
    $beProc = Start-Process -FilePath $python `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "8000" `
        -WorkingDirectory $backend -WindowStyle Hidden -PassThru
}

# 3. Attend que le backend réponde (max ~45 s).
for ($i = 0; $i -lt 60; $i++) {
    if (Test-Backend) { break }
    Start-Sleep -Milliseconds 700
}

# 4. Lance l'application et attend sa fermeture.
if (Test-Path $exe) {
    Start-Process -FilePath $exe -Wait
} else {
    [System.Windows.Forms.MessageBox]::Show("L'application n'est pas encore compilée.`nLance d'abord : npx tauri build", "Kabrig") | Out-Null
}

# 5. À la fermeture : arrête le backend qu'on a démarré (laisse Ollama tourner).
if ($beProc) { Stop-Process -Id $beProc.Id -Force }
