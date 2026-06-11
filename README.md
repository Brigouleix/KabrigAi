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
- [x] Phase 2 — Tools : météo (Open-Meteo), notes (SQLite), lecture documents
- [x] Phase 3 — UI dynamique : carte météo, markdown, mémoire conversationnelle
- [x] Phase 4 — Travel : liens pré-remplis Google Flights/Kayak/Skyscanner/Booking/Airbnb + bouton stop
- [ ] Phase 5 — Polish : mails, RAG documents, tray, raccourcis globaux

> Note : l'API Amadeus Self-Service a été écartée (portail décommissionné le 17/07/2026).
