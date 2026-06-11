"""RAG local : indexation et recherche dans les documents d'Antoine.

Pipeline : extraction texte (pdf/docx/txt/md) → chunks → embeddings Ollama
(nomic-embed-text) → ChromaDB persistant.
"""
from pathlib import Path

import chromadb
import httpx

OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "nomic-embed-text"
DOCS_DIR = Path.home() / "Documents"
CHROMA_DIR = Path(__file__).parent.parent / "chroma"

CHUNK_SIZE = 1500
CHUNK_OVERLAP = 200

_client = chromadb.PersistentClient(path=str(CHROMA_DIR))
_collection = _client.get_or_create_collection("documents")


def extract_text(path: Path) -> str:
    """Extrait le texte d'un fichier pdf, docx, txt, md, csv..."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(path)
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if suffix in {".docx", ".doc"}:
        import docx

        document = docx.Document(path)
        return "\n".join(p.text for p in document.paragraphs)
    if suffix in {".txt", ".md", ".csv", ".json", ".log"}:
        return path.read_text(encoding="utf-8", errors="replace")
    raise ValueError(f"Format non supporté : {suffix}")


def chunk_text(text: str) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        chunks.append(text[start : start + CHUNK_SIZE])
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return [c for c in chunks if c.strip()]


async def embed(texts: list[str]) -> list[list[float]]:
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": texts},
        )
    r.raise_for_status()
    return r.json()["embeddings"]


def _resolve(path: str) -> Path | None:
    target = (DOCS_DIR / path).resolve()
    return target if target.is_relative_to(DOCS_DIR) and target.is_file() else None


async def index_document(path: str) -> str:
    """Indexe un document du dossier Documents pour la recherche."""
    target = _resolve(path)
    if target is None:
        return f"Fichier introuvable : {path} (accès limité à Documents)"
    try:
        text = extract_text(target)
    except ValueError as e:
        return str(e)
    if not text.strip():
        return f"Aucun texte extractible dans {path}."

    chunks = chunk_text(text)
    embeddings = await embed(chunks)
    rel = str(target.relative_to(DOCS_DIR))
    # Réindexation propre : on supprime l'ancienne version du fichier.
    _collection.delete(where={"source": rel})
    _collection.upsert(
        ids=[f"{rel}::{i}" for i in range(len(chunks))],
        documents=chunks,
        embeddings=embeddings,
        metadatas=[{"source": rel, "chunk": i} for i in range(len(chunks))],
    )
    return f"« {rel} » indexé : {len(chunks)} passages ({len(text)} caractères)."


async def search_documents(query: str, max_results: int = 5) -> str:
    """Recherche sémantique dans les documents indexés."""
    if _collection.count() == 0:
        return "Aucun document indexé. Utilise index_document d'abord."
    q_embed = await embed([query])
    res = _collection.query(
        query_embeddings=q_embed,
        n_results=min(max_results, _collection.count()),
    )
    docs = res["documents"][0]
    metas = res["metadatas"][0]
    return "\n\n---\n\n".join(
        f"[{m['source']} · passage {m['chunk']}]\n{d}" for d, m in zip(docs, metas)
    )


def list_indexed() -> str:
    """Liste les documents présents dans l'index."""
    if _collection.count() == 0:
        return "Aucun document indexé."
    metas = _collection.get(include=["metadatas"])["metadatas"]
    sources = sorted({m["source"] for m in metas})
    return "Documents indexés :\n" + "\n".join(f"- {s}" for s in sources)


RAG_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "index_document",
            "description": (
                "Indexe un document (pdf, docx, txt, md...) du dossier Documents "
                "pour pouvoir le questionner ensuite avec search_documents."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Chemin relatif à Documents"}
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_documents",
            "description": (
                "Recherche sémantique dans les documents indexés. À utiliser pour "
                "répondre à toute question sur le contenu des documents d'Antoine."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Question ou sujet recherché"},
                    "max_results": {"type": "integer", "description": "Défaut 5"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_indexed",
            "description": "Liste les documents déjà indexés pour la recherche.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]
