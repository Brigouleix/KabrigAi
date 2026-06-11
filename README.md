# ⚡ Kabrig AI

Assistant personnel de bureau type "JARVIS" — 100% local et gratuit.

## Stack

- **Frontend** : Tauri v2 + React + TypeScript (Vite)
- **Backend** : FastAPI (Python)
- **LLMs** : Ollama — `qwen2.5:7b` (routeur léger) + `qwen2.5:32b` (cerveau)

## Prérequis

- Node.js ≥ 20, Rust (rustup), Python ≥ 3.11, [Ollama](https://ollama.com)

## Installation des modèles

```powershell
ollama pull qwen2.5:7b
ollama pull qwen2.5:32b
```

## Lancer en dev

Terminal 1 — backend :
```powershell
cd backend
.\.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

Terminal 2 — app desktop :
```powershell
cd frontend
npx tauri dev
```

(ou juste `npm run dev` dans frontend/ pour la version navigateur)

## Roadmap

- [x] Phase 1 — Socle : chat streamé, routing light/heavy
- [ ] Phase 2 — Tools MCP : météo, fichiers, notes (SQLite), RAG documents
- [ ] Phase 3 — UI Jarvis : composants dynamiques, mémoire conversationnelle
- [ ] Phase 4 — Travel : vols (Amadeus), logements, météo (OpenWeatherMap)
- [ ] Phase 5 — Polish : mails, tray, raccourcis globaux
