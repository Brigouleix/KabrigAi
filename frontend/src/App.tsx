import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WeatherCard, type WeatherData } from "./WeatherCard";
import { RouteCard, type RouteData } from "./RouteCard";
import "./App.css";

const BACKEND = "http://localhost:8000";
const isTauri = "__TAURI_INTERNALS__" in window;

function ExternalLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={props.href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        if (isTauri && props.href) {
          e.preventDefault();
          openUrl(props.href);
        }
      }}
    />
  );
}

type Message = {
  role: "user" | "assistant";
  content: string;
  model?: string;
  tools?: string[];
  weather?: WeatherData;
  route?: RouteData;
};

type AgendaEvent = {
  id: number;
  title: string;
  date: string;
  time: string;
  location: string;
  notes: string;
};

type Prefs = { city: string; sports: string[]; tiles: string[]; spotify: string };

type Dashboard = {
  weather: { data?: WeatherData } | WeatherData | null;
  sport: { title: string; url: string; source: string }[];
  sorties: string;
  mail: { configured: boolean; unread?: number; messages: { subject: string; from: string }[] };
  events: AgendaEvent[];
  prefs: Prefs;
};

function spotifyEmbedUrl(url: string): string | null {
  const m = url.match(/open\.spotify\.com\/(playlist|album|track|artist)\/([A-Za-z0-9]+)/);
  return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}?theme=0` : null;
}

const ALL_SPORTS = ["tous", "football", "rugby", "tennis", "basket", "cyclisme", "formule 1"];

type Tab = "accueil" | "chat" | "agenda";

/* ---------------- Chat ---------------- */

function ChatView({
  messages,
  setMessages,
  busy,
  setBusy,
  initialInput = "",
}: {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  busy: boolean;
  setBusy: (b: boolean) => void;
  initialInput?: string;
}) {
  const [input, setInput] = useState(initialInput);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
    setBusy(true);

    const history: Message[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${BACKEND}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
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
            if (evt.type === "widget" && evt.widget === "weather") last.weather = evt.data;
            if (evt.type === "widget" && evt.widget === "route") last.route = evt.data;
            next[next.length - 1] = last;
            return next;
          });
        }
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      setMessages((prev) => {
        const next = [...prev];
        const last = { ...next[next.length - 1] };
        if (aborted) {
          last.content += last.content ? "\n\n*[interrompu]*" : "*[interrompu]*";
        } else {
          last.content ||= "⚠️ Backend injoignable (lance `uvicorn app.main:app` dans backend/)";
        }
        next[next.length - 1] = last;
        return next;
      });
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND}/api/upload`, { method: "POST", body: form });
      const { saved } = await res.json();
      setBusy(false);
      await send(`Lis et résume le document importé : ${saved.replaceAll("\\", "/")}`);
    } catch {
      setBusy(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ Échec de l'import du fichier." },
      ]);
    }
  }

  return (
    <>
      <main>
        {messages.length === 0 && (
          <p className="empty">
            Bonjour, je suis Kabrig.
            <br />
            Météo, itinéraires, documents, mails, agenda… demande-moi tout.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.model && <span className="model">{m.model}</span>}
            {m.tools?.map((t, j) => (
              <span key={j} className="tool">
                🔧 {t}
              </span>
            ))}
            {m.weather && <WeatherCard data={m.weather} />}
            {m.route && <RouteCard data={m.route} />}
            {m.role === "assistant" ? (
              m.content ? (
                <Markdown components={{ a: ExternalLink }}>{m.content}</Markdown>
              ) : (
                <p>{busy && i === messages.length - 1 ? "…" : ""}</p>
              )
            ) : (
              <p>{m.content}</p>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      <footer>
        <input
          type="file"
          ref={fileRef}
          hidden
          accept=".pdf,.docx,.doc,.txt,.md,.csv,.json,.log"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = "";
          }}
        />
        <button
          className="icon-btn"
          title="Importer un fichier (pdf, docx, txt...)"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          📎
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Écris un message…"
          disabled={busy}
        />
        {busy ? (
          <button className="stop" onClick={() => abortRef.current?.abort()}>
            ■ Stop
          </button>
        ) : (
          <button onClick={() => send()} disabled={!input.trim()}>
            Envoyer
          </button>
        )}
      </footer>
    </>
  );
}

/* ---------------- Accueil ---------------- */

function HomeView({ goChat }: { goChat: (prompt: string) => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(c = "") {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND}/api/dashboard?city=${encodeURIComponent(c)}`);
      const json: Dashboard = await res.json();
      setData(json);
      setCity(json.prefs.city);
    } catch {
      setData(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveCity() {
    await fetch(`${BACKEND}/api/prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city }),
    });
    load(city);
  }

  async function toggleSport(sport: string) {
    const current = data?.prefs.sports ?? ["tous"];
    let next: string[];
    if (sport === "tous") {
      next = ["tous"];
    } else {
      const base = current.filter((s) => s !== "tous");
      next = base.includes(sport) ? base.filter((s) => s !== sport) : [...base, sport];
      if (next.length === 0) next = ["tous"];
    }
    await fetch(`${BACKEND}/api/prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sports: next }),
    });
    load();
  }

  const weather = (data?.weather as { data?: WeatherData })?.data ?? (data?.weather as WeatherData | null);
  const tiles = data?.prefs.tiles ?? ["weather", "agenda", "sport", "sorties"];

  return (
    <main className="dashboard">
      <div className="dash-bar">
        <h2>
          Bonjour Antoine <span className="wave">👋</span>
        </h2>
        <div className="dash-city">
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveCity()}
            placeholder="Ville"
          />
          <button onClick={() => load()} disabled={loading}>
            {loading ? "…" : "⟳"}
          </button>
        </div>
      </div>

      <div className="quick-actions">
        {["Quoi de neuf aujourd'hui ?", "Rédige un mail", "Crée un PDF", "Itinéraire"].map((q) => (
          <button key={q} className="chip" onClick={() => goChat(q === "Itinéraire" ? "Itinéraire de " : q)}>
            {q}
          </button>
        ))}
      </div>

      <div className="tiles">
        {tiles.map((t) => {
          if (t === "weather")
            return (
              <section className="tile" key={t}>
                <h3>🌤️ Météo</h3>
                {weather && weather.city ? (
                  <WeatherCard data={weather} />
                ) : (
                  <p className="tile-empty">{loading ? "Chargement…" : "Indisponible"}</p>
                )}
              </section>
            );
          if (t === "agenda")
            return (
              <section className="tile" key={t}>
                <h3>📅 Agenda</h3>
                {data?.events?.length ? (
                  <ul className="tile-list">
                    {data.events.map((e) => (
                      <li key={e.id}>
                        <span className="event-date">
                          {e.date.slice(8, 10)}/{e.date.slice(5, 7)} {e.time}
                        </span>
                        <span>{e.title}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="tile-empty">Rien de prévu. Dis-le à Kabrig ou utilise l'onglet Agenda.</p>
                )}
              </section>
            );
          if (t === "sport")
            return (
              <section className="tile" key={t}>
                <h3>🏉 Sport</h3>
                <div className="sport-filters">
                  {ALL_SPORTS.map((s) => (
                    <button
                      key={s}
                      className={`chip small ${data?.prefs.sports.includes(s) ? "active" : ""}`}
                      onClick={() => toggleSport(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {data?.sport?.length ? (
                  <ul className="tile-list">
                    {data.sport.map((s, i) => (
                      <li key={i}>
                        <ExternalLink href={s.url}>{s.title}</ExternalLink>
                        {s.source && <span className="src">{s.source}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="tile-empty">{loading ? "Chargement…" : "Pas d'actu sport."}</p>
                )}
              </section>
            );
          if (t === "mail")
            return (
              <section className="tile" key={t}>
                <h3>
                  📬 Boîte mail
                  {data?.mail?.configured && <span className="badge">{data.mail.unread} non lus</span>}
                </h3>
                {!data?.mail?.configured ? (
                  <p className="tile-empty">
                    Non configurée — ajoute GMAIL_ADDRESS et GMAIL_APP_PASSWORD dans backend/.env
                    (le même que pour l'envoi de mails).
                  </p>
                ) : data.mail.messages.length ? (
                  <ul className="tile-list">
                    {data.mail.messages.map((m, i) => (
                      <li key={i}>
                        <span className="mail-from">{m.from}</span>
                        <span>{m.subject}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="tile-empty">Aucun mail non lu 🎉</p>
                )}
                <ExternalLink className="tile-link" href="https://mail.google.com">
                  Ouvrir Gmail →
                </ExternalLink>
              </section>
            );
          if (t === "spotify") {
            const embed = data ? spotifyEmbedUrl(data.prefs.spotify) : null;
            return (
              <section className="tile" key={t}>
                <h3>🎵 Spotify</h3>
                {embed ? (
                  <iframe
                    className="spotify-frame"
                    src={embed}
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="lazy"
                    title="Spotify"
                  />
                ) : (
                  <p className="tile-empty">Colle une URL open.spotify.com dans les préférences.</p>
                )}
                <input
                  className="spotify-input"
                  placeholder="🔍 Titre, artiste, album… ou colle un lien Spotify"
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter") return;
                    const value = e.currentTarget.value.trim();
                    if (!value) return;
                    if (value.includes("open.spotify.com")) {
                      await fetch(`${BACKEND}/api/prefs`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ spotify: value }),
                      });
                    } else {
                      await fetch(`${BACKEND}/api/spotify/search?q=${encodeURIComponent(value)}`);
                    }
                    load();
                  }}
                />
              </section>
            );
          }
          if (t === "whatsapp")
            return (
              <section className="tile" key={t}>
                <h3>💬 WhatsApp</h3>
                <p className="tile-empty">
                  WhatsApp n'a pas d'API publique — mais ton WhatsApp Web s'ouvre en un clic.
                </p>
                <ExternalLink className="wa-btn" href="https://web.whatsapp.com">
                  Ouvrir WhatsApp Web
                </ExternalLink>
              </section>
            );
          if (t === "sorties")
            return (
              <section className="tile" key={t}>
                <h3>🎉 Idées de sortie</h3>
                {data?.sorties ? (
                  <div className="tile-md">
                    <Markdown components={{ a: ExternalLink }}>{data.sorties}</Markdown>
                  </div>
                ) : (
                  <p className="tile-empty">{loading ? "Chargement…" : "Aucune suggestion."}</p>
                )}
              </section>
            );
          return null;
        })}
        {tiles.length === 0 && (
          <p className="tile-empty">
            Toutes les tuiles sont masquées. Demande à Kabrig de les réafficher !
          </p>
        )}
      </div>
    </main>
  );
}

/* ---------------- Agenda ---------------- */

function AgendaView() {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [form, setForm] = useState({ title: "", date: "", time: "", location: "" });

  async function refresh() {
    const res = await fetch(`${BACKEND}/api/agenda`);
    const json = await res.json();
    setEvents(json.events);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function add() {
    if (!form.title || !form.date) return;
    const res = await fetch(`${BACKEND}/api/agenda`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, notes: "" }),
    });
    setEvents((await res.json()).events);
    setForm({ title: "", date: "", time: "", location: "" });
  }

  async function remove(id: number) {
    const res = await fetch(`${BACKEND}/api/agenda/${id}`, { method: "DELETE" });
    setEvents((await res.json()).events);
  }

  return (
    <main className="agenda">
      <div className="agenda-form tile">
        <h3>➕ Nouvel événement</h3>
        <div className="agenda-fields">
          <input
            placeholder="Titre"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
          <input
            type="time"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
          />
          <input
            placeholder="Lieu (optionnel)"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
          <button onClick={add} disabled={!form.title || !form.date}>
            Ajouter
          </button>
        </div>
      </div>

      <div className="tile">
        <h3>📅 À venir</h3>
        {events.length === 0 && <p className="tile-empty">Aucun événement.</p>}
        <ul className="agenda-list">
          {events.map((e) => (
            <li key={e.id}>
              <span className="event-date">
                {e.date.slice(8, 10)}/{e.date.slice(5, 7)}/{e.date.slice(0, 4)} {e.time}
              </span>
              <span className="event-title">{e.title}</span>
              {e.location && <span className="event-loc">📍 {e.location}</span>}
              <button className="del" onClick={() => remove(e.id)} title="Supprimer">
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

/* ---------------- App ---------------- */

function App() {
  const [tab, setTab] = useState<Tab>("accueil");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [health, setHealth] = useState<{ ollama: boolean; models: string[] } | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/health`)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ollama: false, models: [] }));
  }, []);

  function goChat(prompt: string) {
    setPendingPrompt(prompt);
    setTab("chat");
  }

  return (
    <div className="app">
      <header>
        <h1>⚡ Kabrig</h1>
        <nav>
          {(["accueil", "chat", "agenda"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "accueil" ? "Accueil" : t === "chat" ? "Chat" : "Agenda"}
            </button>
          ))}
        </nav>
        <span className={`status ${health?.ollama ? "ok" : "ko"}`}>
          {health === null ? "…" : health.ollama ? "En ligne" : "Hors ligne"}
        </span>
      </header>

      {tab === "accueil" && <HomeView goChat={goChat} />}
      {tab === "chat" && (
        <ChatView
          messages={messages}
          setMessages={setMessages}
          busy={busy}
          setBusy={setBusy}
          initialInput={pendingPrompt}
          key={pendingPrompt /* remount pour préremplir */}
        />
      )}
      {tab === "agenda" && <AgendaView />}
    </div>
  );
}

export default App;
