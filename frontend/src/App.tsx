import { useEffect, useRef, useState } from "react";
import "./App.css";

const BACKEND = "http://localhost:8000";

type Message = {
  role: "user" | "assistant";
  content: string;
  model?: string;
  tools?: string[];
};

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<{ ollama: boolean; models: string[] } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ollama: false, models: [] }));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const history: Message[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(`${BACKEND}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          setMessages((prev) => {
            const next = [...prev];
            const last = { ...next[next.length - 1] };
            if (evt.type === "model") last.model = evt.model;
            if (evt.type === "token") last.content += evt.content;
            if (evt.type === "tool") last.tools = [...(last.tools ?? []), evt.name];
            next[next.length - 1] = last;
            return next;
          });
        }
      }
    } catch {
      setMessages((prev) => {
        const next = [...prev];
        const last = { ...next[next.length - 1] };
        last.content ||= "⚠️ Backend injoignable (lance `uvicorn app.main:app` dans backend/)";
        next[next.length - 1] = last;
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>⚡ Kabrig</h1>
        <span className={`status ${health?.ollama ? "ok" : "ko"}`}>
          {health === null ? "…" : health.ollama ? `Ollama ✓ (${health.models.length} modèles)` : "Ollama hors ligne"}
        </span>
      </header>

      <main>
        {messages.length === 0 && (
          <p className="empty">Bonjour, je suis Kabrig. Comment puis-je t'aider ?</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.model && <span className="model">{m.model}</span>}
            {m.tools?.map((t, j) => (
              <span key={j} className="tool">🔧 {t}</span>
            ))}
            <p>{m.content || (busy && i === messages.length - 1 ? "…" : "")}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <footer>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Écris un message…"
          disabled={busy}
        />
        <button onClick={send} disabled={busy || !input.trim()}>
          Envoyer
        </button>
      </footer>
    </div>
  );
}

export default App;
