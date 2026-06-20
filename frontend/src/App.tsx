import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WeatherCard, type WeatherData } from "./WeatherCard";
import { RouteCard, type RouteData } from "./RouteCard";
import { ChartCard, type ChartData } from "./ChartCard";
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
  chart?: ChartData;
};

type ChatMeta = { id: number; title: string; updated_at: string };

type AgendaEvent = {
  id: number;
  title: string;
  date: string;
  time: string;
  location: string;
  notes: string;
};

type Prefs = {
  user_name?: string;
  ai_name?: string;
  city: string;
  weather_cities?: (string | { name: string; lat: number; lon: number })[];
  sports: string[];
  tiles: string[];
  spotify: string;
  sizes: Record<string, "s" | "m" | "l">;
  custom: { id: string; title: string; query: string }[];
};

type NewsItem = { title: string; url: string; source: string };

type Todo = { id: number; text: string; done: number };

type Note = { id: number; title: string; content: string; folder: string };

type Dashboard = {
  todos: Todo[];
  notes: Note[];
  weathers?: WeatherData[];
  weather: { data?: WeatherData } | WeatherData | null;
  sport: NewsItem[];
  sorties: string;
  mail: { configured: boolean; unread?: number; messages: { subject: string; from: string }[] };
  custom: Record<string, NewsItem[]>;
  events: AgendaEvent[];
  prefs: Prefs;
};

type SpotifyStatus = {
  configured: boolean;
  connected: boolean;
  player?: { playing: boolean; track?: string; artist?: string; device?: string };
};

function spotifyEmbedUrl(url: string): string | null {
  const m = url.match(/open\.spotify\.com\/(playlist|album|track|artist)\/([A-Za-z0-9]+)/);
  return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}?theme=0` : null;
}

const ALL_SPORTS = ["tous", "football", "rugby", "tennis", "basket", "cyclisme", "formule 1"];

type Tab = "accueil" | "chat" | "agenda" | "reglages";

const TILE_LABELS: Record<string, string> = {
  weather: "🌤️ Météo",
  todo: "✅ Todo list",
  notes: "🗒️ Notes",
  route: "🗺️ Itinéraire",
  agenda: "📅 Agenda",
  sport: "🏉 Sport",
  sorties: "🎉 Idées de sortie",
  mail: "📬 Boîte mail",
  spotify: "🎵 Spotify",
  whatsapp: "💬 WhatsApp",
};

/* ---------------- Sphère IA + réflexion ---------------- */

function Logo() {
  const [err, setErr] = useState(false);
  if (err) return <span className="logo-dot" />;
  return <img src="/kabrig-juste-logo.png" alt="Kabrig" className="logo-img" onError={() => setErr(true)} />;
}

function TitleMark() {
  const [err, setErr] = useState(false);
  if (err) return <span className="logo-name">Kabrig</span>;
  return <img src="/kabrig-juste-titre.png" alt="kabrig" className="title-img" onError={() => setErr(true)} />;
}

function Sphere({ size = 30 }: { size?: number }) {
  return (
    <span className="ai-sphere" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 120 120" width={size} height={size}>
        <defs>
          <radialGradient id="sph-glass" cx="42%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#3a3550" stopOpacity="0.55" />
            <stop offset="70%" stopColor="#1a1730" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#0c0a18" stopOpacity="0.95" />
          </radialGradient>
          <linearGradient id="sph-wave" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ff6ec4" />
            <stop offset="35%" stopColor="#9b6dff" />
            <stop offset="65%" stopColor="#5a8df0" />
            <stop offset="100%" stopColor="#f0a05a" />
          </linearGradient>
          <radialGradient id="sph-halo" cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="#9b6dff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#9b6dff" stopOpacity="0" />
          </radialGradient>
          <filter id="sph-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
          <clipPath id="sph-ball">
            <circle cx="60" cy="60" r="46" />
          </clipPath>
        </defs>

        <circle cx="60" cy="60" r="58" fill="url(#sph-halo)" />
        <circle cx="60" cy="60" r="46" fill="url(#sph-glass)" />

        <g clipPath="url(#sph-ball)">
          {/* ruban flou (glow) */}
          <path fill="none" stroke="url(#sph-wave)" strokeWidth="7" strokeLinecap="round"
                filter="url(#sph-glow)" opacity="0.85">
            <animate attributeName="d" dur="3.2s" repeatCount="indefinite"
              values="M8,62 Q34,42 60,60 T112,58;
                      M8,58 Q34,74 60,52 T112,64;
                      M8,64 Q34,48 60,66 T112,52;
                      M8,62 Q34,42 60,60 T112,58" />
          </path>
          {/* cœur lumineux net */}
          <path fill="none" stroke="url(#sph-wave)" strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="d" dur="3.2s" repeatCount="indefinite"
              values="M8,62 Q34,42 60,60 T112,58;
                      M8,58 Q34,74 60,52 T112,64;
                      M8,64 Q34,48 60,66 T112,52;
                      M8,62 Q34,42 60,60 T112,58" />
          </path>
        </g>

        {/* contour verre + reflet */}
        <circle cx="60" cy="60" r="46" fill="none" stroke="url(#sph-wave)"
                strokeWidth="1.3" opacity="0.45" />
        <ellipse cx="44" cy="40" rx="14" ry="8" fill="#fff" opacity="0.12"
                 transform="rotate(-28 44 40)" />
      </svg>
    </span>
  );
}

// Libellés "réflexion" lisibles pour chaque tool.
const TOOL_THINKING: Record<string, string> = {
  get_weather: "consulte la météo",
  web_search: "cherche sur le web",
  read_webpage: "lit une page web",
  crypto_data: "récupère les données crypto",
  stock_data: "récupère les cours de bourse",
  market_overview: "fait le point sur les marchés",
  create_chart: "trace un graphique",
  get_route: "calcule l'itinéraire",
  create_document: "rédige le document",
  send_email: "prépare l'email",
  index_document: "indexe le document",
  search_documents: "fouille tes documents",
  read_document: "lit le document",
  add_todo: "ajoute à ta todo",
  list_todos: "consulte ta todo",
  complete_todo: "met à jour ta todo",
  delete_todo: "met à jour ta todo",
  create_event: "ajoute à ton agenda",
  list_events: "consulte ton agenda",
  delete_event: "met à jour ton agenda",
  update_preferences: "personnalise ton accueil",
  travel_links: "prépare les liens de voyage",
};

function Thinking({ tools }: { tools?: string[] }) {
  const last = tools?.[tools.length - 1];
  const label = last ? TOOL_THINKING[last] ?? `utilise ${last}` : "réfléchit";
  return (
    <div className="thinking">
      <Sphere />
      <span className="thinking-label">
        Kabrig {label}
        <span className="dots">
          <i />
          <i />
          <i />
        </span>
      </span>
    </div>
  );
}

/* ---------------- Widgets agrandissables ---------------- */

function WidgetBox({ children, name }: { children: React.ReactNode; name: string }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  async function save() {
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(bodyRef.current!, {
      backgroundColor: "#ffffff",
      useCORS: true,
      scale: 2,
    });
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `kabrig-${name}-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  }

  return (
    <>
      <div className="widget-click" onClick={() => setOpen(true)} title="Cliquer pour agrandir">
        {children}
      </div>
      {open && (
        <div className="lightbox" onClick={() => setOpen(false)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <div ref={bodyRef} className="lightbox-body">
              {children}
            </div>
            <div className="lightbox-actions">
              <button onClick={save}>💾 Enregistrer en PNG</button>
              <button className="close" onClick={() => setOpen(false)}>
                ✕ Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
            if (evt.type === "widget" && evt.widget === "chart") last.chart = evt.data;
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
            {m.role === "assistant" && m.content &&
              m.tools?.map((t, j) => (
                <span key={j} className="tool">
                  🔧 {t}
                </span>
              ))}
            {m.weather && (
              <WidgetBox name="meteo">
                <WeatherCard data={m.weather} />
              </WidgetBox>
            )}
            {m.route && (
              <WidgetBox name="itineraire">
                <RouteCard data={m.route} />
              </WidgetBox>
            )}
            {m.chart && (
              <WidgetBox name="graphique">
                <ChartCard data={m.chart} />
              </WidgetBox>
            )}
            {m.role === "assistant" ? (
              m.content ? (
                <Markdown components={{ a: ExternalLink }}>{m.content}</Markdown>
              ) : busy && i === messages.length - 1 ? (
                <Thinking tools={m.tools} />
              ) : null
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
          accept=".pdf,.docx,.xlsx,.xlsm,.txt,.md,.csv,.json,.log"
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

/* ---------------- Tuile Notes ---------------- */

function NotesTileContent({ filter = "" }: { filter?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [form, setForm] = useState({ title: "", folder: "" });
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (filter) setSearch(filter);
  }, [filter]);

  async function refresh() {
    const res = await fetch(`${BACKEND}/api/notes`);
    setNotes((await res.json()).notes);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function add() {
    if (!form.title.trim()) return;
    await fetch(`${BACKEND}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: form.title, folder: form.folder }),
    });
    setForm({ title: "", folder: form.folder });
    refresh();
  }

  async function saveContent(n: Note) {
    await fetch(`${BACKEND}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: n.id, title: n.title, content: draft, folder: n.folder }),
    });
    setOpenId(null);
    refresh();
  }

  async function remove(id: number) {
    await fetch(`${BACKEND}/api/notes/${id}`, { method: "DELETE" });
    setOpenId(null);
    refresh();
  }

  // Filtre + regroupe par dossier ("" → "Sans dossier").
  const s = search.trim().toLowerCase();
  const filtered = s
    ? notes.filter((n) =>
        (n.title + " " + n.content + " " + n.folder).toLowerCase().includes(s)
      )
    : notes;
  const groups: Record<string, Note[]> = {};
  for (const n of filtered) (groups[n.folder || "Sans dossier"] ??= []).push(n);
  const folderNames = Object.keys(groups).sort();

  return (
    <>
      <input
        className="notes-search"
        placeholder="🔍 Filtrer mes notes…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="notes-add">
        <input
          placeholder="Titre de la note…"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <input
          placeholder="Dossier (ex: Perso/Idées)"
          value={form.folder}
          onChange={(e) => setForm({ ...form, folder: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button onClick={add} disabled={!form.title.trim()}>
          +
        </button>
      </div>

      {notes.length === 0 && <p className="tile-empty">Aucune note. Crée-en une ou demande à Kabrig.</p>}

      {folderNames.map((folder) => (
        <div key={folder} className="note-folder">
          <div className="note-folder-name">📁 {folder}</div>
          {groups[folder].map((n) => (
            <div key={n.id} className="note-item">
              <div
                className="note-head"
                onClick={() => {
                  if (openId === n.id) setOpenId(null);
                  else {
                    setOpenId(n.id);
                    setDraft(n.content);
                  }
                }}
              >
                <span className="note-title">🗒️ {n.title}</span>
                <button
                  className="note-del"
                  title="Supprimer"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Supprimer « ${n.title} » ?`)) remove(n.id);
                  }}
                >
                  ✕
                </button>
              </div>
              {openId === n.id && (
                <div className="note-editor">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Contenu de la note…"
                    rows={5}
                  />
                  <button onClick={() => saveContent(n)}>Enregistrer</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

// Petite barre ⟳ + recherche réutilisée par les tuiles d'actu.
function TileBar({ onRefresh, onSearch, placeholder, busy }: {
  onRefresh: () => void;
  onSearch: (q: string) => void;
  placeholder: string;
  busy: boolean;
}) {
  const [q, setQ] = useState("");
  return (
    <div className="tile-bar">
      <span className="tile-bar-icon">🔍</span>
      <input
        value={q}
        placeholder={placeholder}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSearch(q.trim())}
      />
      <button className="tile-refresh" title="Rafraîchir / dernières actus" onClick={onRefresh} disabled={busy}>
        {busy ? "…" : "⟳"}
      </button>
    </div>
  );
}

function MailTile({ compact = false, tick = 0 }: { compact?: boolean; tick?: number }) {
  const [mail, setMail] = useState<Dashboard["mail"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  async function load() {
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND}/api/tile/mail`);
      setMail(await res.json());
    } catch {
      setMail({ configured: false, messages: [] });
    }
    setBusy(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const msgs = (mail?.messages ?? []).filter((m) =>
    filter ? (m.from + " " + m.subject).toLowerCase().includes(filter.toLowerCase()) : true
  );

  return (
    <>
      {!compact && (
        <TileBar busy={busy} placeholder="Filtrer mes mails…" onRefresh={load} onSearch={setFilter} />
      )}
      {!mail?.configured ? (
        <p className="tile-empty">Non configurée — GMAIL_ADDRESS / GMAIL_APP_PASSWORD dans backend/.env</p>
      ) : msgs.length ? (
        <ul className="tile-list">
          {msgs.map((m, i) => (
            <li key={i}>
              <span className="mail-from">{m.from}</span>
              <span>{m.subject}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tile-empty">{busy ? "Chargement…" : "Aucun mail."}</p>
      )}
      <ExternalLink className="tile-link" href="https://mail.google.com">Ouvrir Gmail →</ExternalLink>
    </>
  );
}

function SportTile({ sports, onToggleSport, compact = false, tick = 0 }: {
  sports: string[];
  onToggleSport: (s: string) => void;
  compact?: boolean;
  tick?: number;
}) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND}/api/tile/sport`);
      setItems((await res.json()).sport);
    } catch {
      setItems([]);
    }
    setBusy(false);
  }
  async function search(q: string) {
    if (!q) return load();
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND}/api/tile/news?q=${encodeURIComponent(q + " sport")}`);
      setItems((await res.json()).items);
    } catch {
      setItems([]);
    }
    setBusy(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sports.join(","), tick]);

  return (
    <>
      {!compact && (
        <TileBar busy={busy} placeholder="Rechercher une actu sport…" onRefresh={load} onSearch={search} />
      )}
      <div className="sport-filters">
        {ALL_SPORTS.map((s) => (
          <button
            key={s}
            className={`chip small ${sports.includes(s) ? "active" : ""}`}
            onClick={() => onToggleSport(s)}
          >
            {s}
          </button>
        ))}
      </div>
      {items.length ? (
        <ul className="tile-list">
          {items.map((s, i) => (
            <li key={i}>
              <ExternalLink href={s.url}>{s.title}</ExternalLink>
              {s.source && <span className="src">{s.source}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tile-empty">{busy ? "Chargement…" : "Pas d'actu."}</p>
      )}
    </>
  );
}

function CustomTile({ def, compact = false, tick = 0 }: {
  def: { id: string; title: string; query: string };
  compact?: boolean;
  tick?: number;
}) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function load(q?: string) {
    setBusy(true);
    try {
      const res = await fetch(`${BACKEND}/api/tile/news?q=${encodeURIComponent(q || def.query)}`);
      setItems((await res.json()).items);
    } catch {
      setItems([]);
    }
    setBusy(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.query, tick]);

  return (
    <>
      {!compact && (
        <TileBar busy={busy} placeholder="Rechercher…" onRefresh={() => load()} onSearch={(q) => load(q || def.query)} />
      )}
      {items.length ? (
        <ul className="tile-list">
          {items.map((s, i) => (
            <li key={i}>
              <ExternalLink href={s.url}>{s.title}</ExternalLink>
              {s.source && <span className="src">{s.source}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tile-empty">{busy ? "Chargement…" : "Aucune actu."}</p>
      )}
    </>
  );
}

// Champ ville réutilisable avec autocomplétion (géocodage Open-Meteo).
type GeoCity = { name: string; label: string; lat: number; lon: number };

function CityInput({
  value,
  onChange,
  onSelect,
  onSelectFull,
  placeholder = "Rechercher une ville…",
  address = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (name: string) => void;
  onSelectFull?: (c: GeoCity) => void;
  placeholder?: string;
  address?: boolean;
}) {
  const [sugg, setSugg] = useState<GeoCity[]>([]);
  const [open, setOpen] = useState(false);
  // Ne cherche QUE quand l'utilisateur tape réellement (pas quand le champ est
  // pré-rempli au chargement → sinon le menu s'ouvre tout seul sur le dashboard).
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!typing) return;
    const q = value.trim();
    const minLen = address ? 3 : 2;
    if (q.length < minLen) {
      setSugg([]);
      setOpen(false);
      return;
    }
    const endpoint = address ? "geocode-address" : "geocode";
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`${BACKEND}/api/${endpoint}?q=${encodeURIComponent(q)}`);
        setSugg((await res.json()).results);
        setOpen(true);
      } catch {
        setSugg([]);
      }
    }, address ? 600 : 250); // Nominatim : 1 req/s max → débounce plus long
    return () => clearTimeout(id);
  }, [value, typing, address]);

  function pick(c: GeoCity | string) {
    if (typeof c === "string") onSelect(c.trim());
    else if (onSelectFull) onSelectFull(c);
    else onSelect(c.name);
    setSugg([]);
    setOpen(false);
    setTyping(false);
  }

  return (
    <div className="city-ac">
      <input
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          setTyping(true);
          onChange(e.target.value);
        }}
        onBlur={() => setTimeout(() => {
          setOpen(false);
          setTyping(false);
        }, 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") pick(sugg[0] ?? value);
          if (e.key === "Escape") {
            setOpen(false);
            setTyping(false);
          }
        }}
      />
      {open && sugg.length > 0 && (
        <ul className="city-ac-list">
          {sugg.map((s) => (
            <li key={s.label} onMouseDown={() => pick(s)}>
              <span aria-hidden>📍</span> {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WeatherCarousel({ weathers }: { weathers: WeatherData[] }) {
  const [i, setI] = useState(0);
  if (!weathers.length) return null;
  const idx = ((i % weathers.length) + weathers.length) % weathers.length;
  return (
    <div className="weather-carousel">
      <WeatherCard data={weathers[idx]} />
      {weathers.length > 1 && (
        <div className="wc-nav">
          <button onClick={() => setI(i - 1)} aria-label="Précédent">‹</button>
          <div className="wc-dots">
            {weathers.map((w, k) => (
              <span
                key={w.city}
                className={k === idx ? "on" : ""}
                onClick={() => setI(k)}
                title={w.city}
              />
            ))}
          </div>
          <button onClick={() => setI(i + 1)} aria-label="Suivant">›</button>
        </div>
      )}
    </div>
  );
}

function RouteTile() {
  const [origin, setOrigin] = useState("");
  const [dest, setDest] = useState("");
  // Coordonnées exactes du lieu choisi dans les suggestions (adresse précise).
  const [oCoord, setOCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [dCoord, setDCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [mode, setMode] = useState("voiture");
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [err, setErr] = useState("");

  async function calc() {
    if (!origin.trim() || !dest.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      let url = `${BACKEND}/api/route?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&mode=${mode}`;
      if (oCoord) url += `&olat=${oCoord.lat}&olon=${oCoord.lon}`;
      if (dCoord) url += `&dlat=${dCoord.lat}&dlon=${dCoord.lon}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.ok) setRoute(json.data);
      else {
        setRoute(null);
        setErr(json.text || "Itinéraire introuvable.");
      }
    } catch {
      setErr("Erreur réseau.");
    }
    setBusy(false);
  }

  const modes: [string, string][] = [
    ["voiture", "🚗"],
    ["velo", "🚴"],
    ["pieton", "🚶"],
  ];

  return (
    <>
      <div className="route-form">
        <CityInput
          address
          value={origin}
          onChange={(v) => {
            setOrigin(v);
            setOCoord(null);
          }}
          onSelect={setOrigin}
          onSelectFull={(c) => {
            setOrigin(c.label);
            setOCoord({ lat: c.lat, lon: c.lon });
          }}
          placeholder="Départ (ville ou adresse)…"
        />
        <CityInput
          address
          value={dest}
          onChange={(v) => {
            setDest(v);
            setDCoord(null);
          }}
          onSelect={setDest}
          onSelectFull={(c) => {
            setDest(c.label);
            setDCoord({ lat: c.lat, lon: c.lon });
          }}
          placeholder="Arrivée (ville ou adresse)…"
        />
        <div className="route-form-bottom">
          <div className="route-modes">
            {modes.map(([m, icon]) => (
              <button
                key={m}
                className={`route-mode ${mode === m ? "active" : ""}`}
                onClick={() => setMode(m)}
                title={m}
              >
                {icon}
              </button>
            ))}
          </div>
          <button className="route-go" onClick={calc} disabled={busy || !origin.trim() || !dest.trim()}>
            {busy ? "…" : "Calculer"}
          </button>
        </div>
      </div>
      {err && <p className="tile-empty">{err}</p>}
      {route && (
        <>
          <RouteCard data={route} />
          <ExternalLink className="gmaps-btn" href={gmapsUrl(route)}>
            <span aria-hidden>📍</span> Ouvrir dans Google Maps
          </ExternalLink>
        </>
      )}
    </>
  );
}

function gmapsUrl(r: RouteData): string {
  const travel =
    r.mode === "velo" ? "bicycling" : r.mode === "pieton" ? "walking" : "driving";
  const o = `${r.start[0]},${r.start[1]}`;
  const d = `${r.end[0]},${r.end[1]}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=${travel}`;
}

function WeatherManager({
  cityList,
  weathers,
  onChange,
}: {
  cityList: (string | { name: string; lat: number; lon: number })[];
  weathers: WeatherData[];
  onChange: () => void;
}) {
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const cities = cityList;
  const nameOf = (c: string | { name: string }) => (typeof c === "string" ? c : c.name);

  async function save(next: typeof cities) {
    setBusy(true);
    await fetch(`${BACKEND}/api/prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weather_cities: next }),
    });
    await Promise.resolve(onChange());
    setBusy(false);
  }

  // Ajout depuis une suggestion : on garde les coordonnées exactes (pas de
  // re-géocodage côté affichage → plus d'ambiguïté Terni IT vs FR).
  function addFull(c: GeoCity) {
    setCity("");
    if (cities.some((x) => nameOf(x).toLowerCase() === c.name.toLowerCase())) return;
    save([...cities, { name: c.name, lat: c.lat, lon: c.lon }]);
  }

  return (
    <div>
      <div className="wm-add">
        <CityInput value={city} onChange={setCity} onSelect={() => {}} onSelectFull={addFull} />
        <button disabled={busy} onClick={() => setCity("")}>
          Effacer
        </button>
      </div>
      <p className="tile-empty" style={{ marginBottom: 10 }}>
        Choisis une ville dans les suggestions pour l'ajouter.
      </p>
      <div className="wm-chips">
        {cities.map((c) => (
          <span key={nameOf(c)} className="wm-chip">
            {nameOf(c)}
            {cities.length > 1 && (
              <button title="Retirer" onClick={() => save(cities.filter((x) => nameOf(x) !== nameOf(c)))}>
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
      {busy && <p className="tile-empty">Mise à jour…</p>}
      <div className="wm-grid">
        {weathers.map((w) => (
          <WeatherCard key={w.city} data={w} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- Accueil ---------------- */

// Tuile à hauteur automatique : mesure son contenu et occupe exactement
// le nombre de rangées nécessaires dans la grille (pas de vide).
function Tile({
  className,
  drag,
  grip,
  children,
  id,
}: {
  className: string;
  drag: React.HTMLAttributes<HTMLElement>;
  grip?: React.HTMLAttributes<HTMLElement>;
  children: React.ReactNode;
  id?: string;
}) {
  const secRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sec = secRef.current;
    const inner = innerRef.current;
    if (!sec || !inner) return;
    const small = className.includes("size-s");
    const apply = () => {
      // contenu + padding (2x18) + marge de grille (16), rangées de 10px
      let span = Math.ceil((inner.offsetHeight + 36 + 16) / 10);
      if (small) span = Math.min(span, 22);
      sec.style.gridRowEnd = `span ${span}`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [className, children]);

  return (
    <section ref={secRef} id={id} className={className} {...drag}>
      {grip && (
        <button className="drag-handle" title="Glisser pour réorganiser" {...grip}>
          ⠿
        </button>
      )}
      <div ref={innerRef}>{children}</div>
    </section>
  );
}

type SearchResult = {
  q: string;
  content: string;
  tools: string[];
  weather?: WeatherData;
  route?: RouteData;
  chart?: ChartData;
};

function HomeView({ goChat, active, onLoaded }: {
  goChat: (prompt: string) => void;
  active: boolean;
  onLoaded?: () => void;
}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [notesFilter, setNotesFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Détection d'intention "in-app" : si la requête vise une tuile, on la met
  // en surbrillance au lieu de lancer une recherche web.
  function detectTile(q: string): { tile: string; filter: string } | null {
    const l = q.toLowerCase();
    const has = (...kw: string[]) => kw.some((k) => l.includes(k));
    const after = (kw: string[]) => {
      for (const k of kw) {
        const i = l.indexOf(k);
        if (i >= 0) return q.slice(i + k.length).replace(/^\s*(sur|de|des|du|à|a|pour)\s+/i, "").trim();
      }
      return "";
    };
    if (has("note", "carnet", "mémo", "memo")) return { tile: "notes", filter: after(["notes sur", "note sur", "notes", "note"]) };
    if (has("todo", "tâche", "tache", "à faire", "a faire")) return { tile: "todo", filter: "" };
    if (has("agenda", "rendez-vous", "rdv", "événement", "evenement", "calendrier")) return { tile: "agenda", filter: "" };
    if (has("météo", "meteo", "temps qu", "il fait", "température", "temperature")) return { tile: "weather", filter: after(["météo", "meteo"]) };
    if (has("sport", "foot", "rugby", "tennis", "basket", "match", "résultat", "resultat")) return { tile: "sport", filter: "" };
    if (has("sortie", "activité", "activite", "que faire")) return { tile: "sorties", filter: "" };
    if (has("mail", "e-mail", "courriel", "boîte", "boite")) return { tile: "mail", filter: "" };
    return null;
  }

  function focusTile(tile: string, filter: string) {
    if (tile === "notes") setNotesFilter(filter);
    setHighlight(tile);
    setTimeout(() => {
      document.getElementById(`tile-${tile}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    setTimeout(() => setHighlight(null), 2600);
  }

  async function runSearch() {
    const q = query.trim();
    if (!q || searchBusy) return;
    const intent = detectTile(q);
    if (intent) {
      setQuery("");
      focusTile(intent.tile, intent.filter);
      return;
    }
    setQuery("");
    setSearchBusy(true);
    setResult({ q, content: "", tools: [] });
    try {
      const res = await fetch(`${BACKEND}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: `Cherche sur internet et réponds : ${q}` }],
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
          setResult((r) => {
            if (!r) return r;
            const next = { ...r };
            if (evt.type === "token") next.content += evt.content;
            if (evt.type === "tool") next.tools = [...next.tools, evt.name];
            if (evt.type === "widget" && evt.widget === "weather") next.weather = evt.data;
            if (evt.type === "widget" && evt.widget === "route") next.route = evt.data;
            if (evt.type === "widget" && evt.widget === "chart") next.chart = evt.data;
            return next;
          });
        }
      }
    } catch {
      setResult((r) => (r ? { ...r, content: r.content || "⚠️ Recherche impossible." } : r));
    } finally {
      setSearchBusy(false);
    }
  }

  async function load(c = ""): Promise<boolean> {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND}/api/dashboard?city=${encodeURIComponent(c)}`);
      const json: Dashboard = await res.json();
      setData(json);
      setCity(json.prefs.city);
      setLoading(false);
      return true;
    } catch {
      setLoading(false);
      return false; // backend injoignable
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Premier chargement avec reconnexion auto : si le backend n'est pas encore
    // prêt (app lancée avant lui), on réessaie toutes les 2,5 s jusqu'à succès.
    (async () => {
      let signaled = false;
      for (let attempt = 0; !cancelled; attempt++) {
        const ok = await load();
        if (ok) {
          onLoaded?.();
          break;
        }
        if (!signaled && attempt >= 3) {
          onLoaded?.(); // après ~7,5 s sans backend, on lève le splash quand même
          signaled = true;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
    })();
    // Rafraîchissement automatique toutes les 10 minutes.
    const id = setInterval(() => {
      load();
      setTick((t) => t + 1);
    }, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveCity(name?: string) {
    const c = (name ?? city).trim();
    if (!c) return;
    await fetch(`${BACKEND}/api/prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: c }),
    });
    load(c);
  }

  async function toggleSport(sport: string) {
    const current = data?.prefs?.sports ?? ["tous"];
    let next: string[];
    if (sport === "tous") {
      next = ["tous"];
    } else {
      const base = current.filter((s) => s !== "tous");
      next = base.includes(sport) ? base.filter((s) => s !== sport) : [...base, sport];
      if (next.length === 0) next = ["tous"];
    }
    // Maj locale immédiate (SportTile se recharge via sa prop sports), puis persistance.
    setData((d) => (d ? { ...d, prefs: { ...d.prefs, sports: next } } : d));
    fetch(`${BACKEND}/api/prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sports: next }),
    }).catch(() => {});
  }

  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);

  useEffect(() => {
    const check = () =>
      fetch(`${BACKEND}/api/spotify/status`)
        .then((r) => r.json())
        .then(setSpotify)
        .catch(() => setSpotify(null));
    check();
    // Revérifie quand on revient sur la fenêtre (ex. après l'OAuth navigateur).
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);

  async function spotifyAction(action: string) {
    const res = await fetch(`${BACKEND}/api/spotify/control/${action}`, { method: "POST" });
    const json = await res.json();
    if (json.error) alert(json.error);
    else setSpotify((s) => (s ? { ...s, player: json } : s));
  }

  async function spotifyPlayQuery(q: string) {
    const res = await fetch(`${BACKEND}/api/spotify/play?q=${encodeURIComponent(q)}`);
    const json = await res.json();
    if (json.error) alert(json.error);
    else setSpotify((s) => (s ? { ...s, player: json } : s));
  }

  async function refreshSpotify() {
    try {
      const res = await fetch(`${BACKEND}/api/spotify/status`);
      setSpotify(await res.json());
    } catch {
      /* ignore */
    }
  }

  async function connectSpotify() {
    const res = await fetch(`${BACKEND}/api/spotify/login`);
    const json = await res.json();
    if (json.error) {
      alert(json.error);
      return;
    }
    if (isTauri) openUrl(json.url);
    else window.open(json.url, "_blank");
    // Vérifie périodiquement la connexion pendant 2 min (le temps que l'OAuth
    // se fasse dans le navigateur), puis met la tuile à jour automatiquement.
    let n = 0;
    const id = setInterval(async () => {
      n++;
      const r = await fetch(`${BACKEND}/api/spotify/status`).then((x) => x.json()).catch(() => null);
      if (r) setSpotify(r);
      if ((r && r.connected) || n > 40) clearInterval(id);
    }, 3000);
  }

  async function cycleSize(tile: string) {
    const order: ("s" | "m" | "l")[] = ["m", "l", "s"];
    const current = data?.prefs?.sizes?.[tile] ?? "m";
    const next = order[(order.indexOf(current) + 1) % order.length];
    const sizes = { ...(data?.prefs?.sizes ?? {}), [tile]: next };
    await fetch(`${BACKEND}/api/prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sizes }),
    });
    setData((d) => (d ? { ...d, prefs: { ...d.prefs, sizes } } : d));
  }

  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  function tileClass(tile: string) {
    const dropping = overKey === tile && dragKey && dragKey !== tile ? " drop-target" : "";
    const hl = highlight === tile ? " highlight" : "";
    return `tile size-${data?.prefs?.sizes?.[tile] ?? "m"}${dragKey === tile ? " dragging" : ""}${dropping}${hl}`;
  }

  // Bouton d'agrandissement présent dans l'en-tête de chaque tuile.
  function ExpandBtn({ tile }: { tile: string }) {
    return (
      <button className="size-btn expand-btn" title="Agrandir" onClick={() => setExpanded(tile)}>
        ⤢
      </button>
    );
  }

  // Drag via une poignée dédiée (⠿) : bien plus fiable en WebView2 que de
  // rendre toute la tuile draggable (conflits avec inputs/boutons internes).
  function handleProps(tile: string) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData("text/plain", tile);
        e.dataTransfer.effectAllowed = "move";
        setDragKey(tile);
      },
      onDragEnd: () => {
        setDragKey(null);
        setOverKey(null);
      },
    };
  }

  function dropProps(tile: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!dragKey) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOverKey(tile);
      },
      onDragLeave: () => setOverKey((k) => (k === tile ? null : k)),
      onDrop: async (e: React.DragEvent) => {
        e.preventDefault();
        const source = e.dataTransfer.getData("text/plain") || dragKey;
        setDragKey(null);
        setOverKey(null);
        if (!source || source === tile || !data) return;
        const order = [...data.prefs.tiles];
        const from = order.indexOf(source);
        const to = order.indexOf(tile);
        if (from === -1 || to === -1) return;
        order.splice(from, 1);
        order.splice(to, 0, source);
        setData((d) => (d ? { ...d, prefs: { ...d.prefs, tiles: order } } : d));
        await fetch(`${BACKEND}/api/prefs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tiles: order }),
        });
      },
    };
  }

  function SizeBtn({ tile }: { tile: string }) {
    const size = data?.prefs?.sizes?.[tile] ?? "m";
    return (
      <button className="size-btn" title="Taille (petit/moyen/grand)" onClick={() => cycleSize(tile)}>
        {size.toUpperCase()}
      </button>
    );
  }

  const weathers: WeatherData[] =
    data?.weathers?.filter((w) => w && w.city) ??
    ((data?.weather as WeatherData)?.city ? [data!.weather as WeatherData] : []);
  const tiles = data?.prefs?.tiles ?? ["weather", "agenda", "sport", "sorties"];

  return (
    <main className="dashboard" style={{ display: active ? undefined : "none" }}>
      <div className="dash-bar">
        <h2>Hello There, {data?.prefs?.user_name ?? ""}</h2>
        <div className="dash-city">
          <CityInput
            value={city}
            onChange={setCity}
            onSelect={(name) => {
              setCity(name);
              saveCity(name);
            }}
            placeholder="Ville par défaut"
          />
          <button
            onClick={() => {
              load();
              setTick((t) => t + 1);
            }}
            disabled={loading}
          >
            {loading ? "…" : "⟳"}
          </button>
        </div>
      </div>

      <div className="dash-search">
        <span className="dash-search-icon">🔍</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          placeholder="Rechercher sur internet, poser une question…"
          disabled={searchBusy}
        />
        <button onClick={runSearch} disabled={searchBusy || !query.trim()}>
          {searchBusy ? "…" : "Rechercher"}
        </button>
      </div>

      <div className="quick-actions">
        {["Quoi de neuf aujourd'hui ?", "Rédige un mail", "Crée un PDF", "Itinéraire"].map((q) => (
          <button key={q} className="chip" onClick={() => goChat(q === "Itinéraire" ? "Itinéraire de " : q)}>
            {q}
          </button>
        ))}
      </div>

      {result && (
        <div className="dash-result">
          <div className="dash-result-head">
            <span className="dash-result-q">🔍 {result.q}</span>
            <button className="dash-result-close" onClick={() => setResult(null)} title="Fermer">
              ✕
            </button>
          </div>
          {result.weather && <WeatherCard data={result.weather} />}
          {result.route && <RouteCard data={result.route} />}
          {result.chart && <ChartCard data={result.chart} />}
          {result.content ? (
            <Markdown components={{ a: ExternalLink }}>{result.content}</Markdown>
          ) : (
            <Thinking tools={result.tools} />
          )}
          {result.content && (
            <button className="dash-result-continue" onClick={() => goChat(result.q)}>
              Continuer dans le chat →
            </button>
          )}
        </div>
      )}

      <div className="tiles">
        {tiles.map((t) => {
          if (t === "weather")
            return (
              <Tile className={tileClass(t)} key={t} drag={dropProps(t)} grip={handleProps(t)} id={`tile-${t}`}>
                <h3>🌤️ Météo <ExpandBtn tile={t} /> <SizeBtn tile={t} /></h3>
                {weathers.length ? (
                  <WeatherCarousel weathers={weathers} />
                ) : (
                  <p className="tile-empty">{loading ? "Chargement…" : "Indisponible"}</p>
                )}
              </Tile>
            );
          if (t === "todo")
            return (
              <Tile className={tileClass(t)} key={t} drag={dropProps(t)} grip={handleProps(t)} id={`tile-${t}`}>
                <h3>✅ Todo list <SizeBtn tile={t} /></h3>
                <div className="todo-add">
                  <input
                    placeholder="Ajouter une tâche…"
                    onKeyDown={async (e) => {
                      if (e.key !== "Enter") return;
                      const text = e.currentTarget.value.trim();
                      if (!text) return;
                      e.currentTarget.value = "";
                      const res = await fetch(`${BACKEND}/api/todos`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ text }),
                      });
                      const { todos } = await res.json();
                      setData((d) => (d ? { ...d, todos } : d));
                    }}
                  />
                </div>
                {data?.todos?.length ? (
                  <ul className="todo-list">
                    {data.todos.map((td) => (
                      <li key={td.id} className={td.done ? "done" : ""}>
                        <button
                          className="todo-check"
                          onClick={async () => {
                            const res = await fetch(`${BACKEND}/api/todos/${td.id}/toggle`, {
                              method: "POST",
                            });
                            const { todos } = await res.json();
                            setData((d) => (d ? { ...d, todos } : d));
                          }}
                        >
                          {td.done ? "✓" : ""}
                        </button>
                        <span>{td.text}</span>
                        <button
                          className="todo-del"
                          onClick={async () => {
                            const res = await fetch(`${BACKEND}/api/todos/${td.id}`, {
                              method: "DELETE",
                            });
                            const { todos } = await res.json();
                            setData((d) => (d ? { ...d, todos } : d));
                          }}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="tile-empty">Rien à faire 🎉 Ajoute une tâche ou dis-le à l'IA.</p>
                )}
                {data?.todos?.some((td) => td.done) && (
                  <button
                    className="todo-clear"
                    onClick={async () => {
                      const res = await fetch(`${BACKEND}/api/todos/clear-done`, { method: "POST" });
                      const { todos } = await res.json();
                      setData((d) => (d ? { ...d, todos } : d));
                    }}
                  >
                    Nettoyer les tâches faites
                  </button>
                )}
              </Tile>
            );
          if (t === "notes")
            return (
              <Tile className={tileClass(t)} key={t} drag={dropProps(t)} grip={handleProps(t)} id={`tile-${t}`}>
                <h3>🗒️ Notes <ExpandBtn tile={t} /> <SizeBtn tile={t} /></h3>
                <NotesTileContent filter={notesFilter} />
              </Tile>
            );
          if (t === "route")
            return (
              <Tile className={tileClass(t)} key={t} drag={dropProps(t)} grip={handleProps(t)} id={`tile-${t}`}>
                <h3>🗺️ Itinéraire <SizeBtn tile={t} /></h3>
                <RouteTile />
              </Tile>
            );
          if (t === "agenda")
            return (
              <Tile className={tileClass(t)} key={t} drag={dropProps(t)} grip={handleProps(t)} id={`tile-${t}`}>
                <h3>📅 Agenda <ExpandBtn tile={t} /> <SizeBtn tile={t} /></h3>
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
              </Tile>
            );
          if (t === "sport")
            return (
              <Tile className={tileClass(t)} key={t} drag={dropProps(t)} grip={handleProps(t)} id={`tile-${t}`}>
                <h3>🏉 Sport <ExpandBtn tile={t} /> <SizeBtn tile={t} /></h3>
                <SportTile sports={data?.prefs?.sports ?? ["tous"]} onToggleSport={toggleSport} compact tick={tick} />
              </Tile>
            );
          if (t === "mail")
            return (
              <Tile className={tileClass(t)} key={t} drag={dropProps(t)} grip={handleProps(t)} id={`tile-${t}`}>
                <h3>📬 Boîte mail <ExpandBtn tile={t} /> <SizeBtn tile={t} /></h3>
                <MailTile compact tick={tick} />
              </Tile>
            );
          if (t === "spotify") {
            const embed = data ? spotifyEmbedUrl(data.prefs.spotify) : null;
            return (
              <Tile className={tileClass(t)} key={t} drag={dropProps(t)} grip={handleProps(t)} id={`tile-${t}`}>
                <h3>🎵 Spotify <SizeBtn tile={t} /></h3>
                {spotify?.configured && !spotify.connected && (
                  <div className="spotify-connect-row">
                    <button className="wa-btn spotify-connect" onClick={connectSpotify}>
                      Connecter mon compte Spotify
                    </button>
                    <button className="tile-refresh" title="J'ai autorisé : vérifier" onClick={refreshSpotify}>
                      ⟳
                    </button>
                  </div>
                )}
                {spotify?.connected && (
                  <div className="spotify-player">
                    <div className="now-playing">
                      {spotify.player?.track ? (
                        <>
                          <strong>{spotify.player.track}</strong>
                          <span>{spotify.player.artist}</span>
                          {spotify.player.device && <span className="src">sur {spotify.player.device}</span>}
                        </>
                      ) : (
                        <span className="tile-empty">Rien en lecture — ouvre Spotify quelque part.</span>
                      )}
                    </div>
                    <div className="spotify-controls">
                      <button onClick={() => spotifyAction("previous")}>⏮</button>
                      <button onClick={() => spotifyAction(spotify.player?.playing ? "pause" : "play")}>
                        {spotify.player?.playing ? "⏸" : "▶"}
                      </button>
                      <button onClick={() => spotifyAction("next")}>⏭</button>
                    </div>
                  </div>
                )}
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
                  placeholder={
                    spotify?.connected
                      ? "🔍 Titre/artiste → lecture directe sur ton appareil"
                      : "🔍 Titre, artiste, album… ou colle un lien Spotify"
                  }
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter") return;
                    const value = e.currentTarget.value.trim();
                    if (!value) return;
                    e.currentTarget.value = "";
                    if (value.includes("open.spotify.com")) {
                      await fetch(`${BACKEND}/api/prefs`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ spotify: value }),
                      });
                      load();
                    } else if (spotify?.connected) {
                      spotifyPlayQuery(value);
                    } else {
                      await fetch(`${BACKEND}/api/spotify/search?q=${encodeURIComponent(value)}`);
                      load();
                    }
                  }}
                />
              </Tile>
            );
          }
          if (t === "whatsapp")
            return (
              <Tile className={tileClass(t)} key={t} drag={dropProps(t)} grip={handleProps(t)} id={`tile-${t}`}>
                <h3>💬 WhatsApp <SizeBtn tile={t} /></h3>
                <p className="tile-empty">
                  WhatsApp n'a pas d'API publique — mais ton WhatsApp Web s'ouvre en un clic.
                </p>
                <ExternalLink className="wa-btn" href="https://web.whatsapp.com">
                  Ouvrir WhatsApp Web
                </ExternalLink>
              </Tile>
            );
          if (t === "sorties")
            return (
              <Tile className={tileClass(t)} key={t} drag={dropProps(t)} grip={handleProps(t)} id={`tile-${t}`}>
                <h3>🎉 Idées de sortie <SizeBtn tile={t} /></h3>
                {data?.sorties ? (
                  <div className="tile-md">
                    <Markdown components={{ a: ExternalLink }}>{data.sorties}</Markdown>
                  </div>
                ) : (
                  <p className="tile-empty">{loading ? "Chargement…" : "Aucune suggestion."}</p>
                )}
              </Tile>
            );
          if (t.startsWith("custom:")) {
            const id = t.slice(7);
            const def = data?.prefs?.custom?.find((c) => c.id === id);
            if (!def) return null;
            return (
              <Tile className={tileClass(t)} key={t} drag={dropProps(t)} grip={handleProps(t)} id={`tile-${t}`}>
                <h3>
                  📌 {def.title} <ExpandBtn tile={t} /> <SizeBtn tile={t} />
                  <button
                    className="size-btn del-tile"
                    title="Supprimer la tuile"
                    onClick={async () => {
                      await fetch(`${BACKEND}/api/prefs`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ remove_tile: id }),
                      });
                      load();
                    }}
                  >
                    ✕
                  </button>
                </h3>
                <CustomTile def={def} compact tick={tick} />
              </Tile>
            );
          }
          return null;
        })}
        {tiles.length === 0 && (
          <p className="tile-empty">
            Toutes les tuiles sont masquées. Demande à Kabrig de les réafficher !
          </p>
        )}
      </div>

      {expanded && (
        <div className="lightbox" onClick={() => setExpanded(null)}>
          <div className="lightbox-content tile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tile-modal-head">
              <h3>
                {expanded.startsWith("custom:")
                  ? data?.prefs?.custom?.find((c) => `custom:${c.id}` === expanded)?.title ?? "Détails"
                  : TILE_LABELS[expanded] ?? "Détails"}
              </h3>
              <button className="lightbox-x" onClick={() => setExpanded(null)}>✕</button>
            </div>
            <div className="tile-modal-body">
              {expanded === "weather" && (
                <WeatherManager
                  cityList={data?.prefs?.weather_cities ?? weathers.map((w) => w.city)}
                  weathers={weathers}
                  onChange={() => load()}
                />
              )}
              {expanded === "notes" && <NotesTileContent />}
              {expanded === "agenda" && <AgendaView />}
              {expanded === "mail" && <MailTile />}
              {expanded === "sport" && (
                <SportTile sports={data?.prefs?.sports ?? ["tous"]} onToggleSport={toggleSport} />
              )}
              {expanded.startsWith("custom:") &&
                (() => {
                  const def = data?.prefs?.custom?.find((c) => `custom:${c.id}` === expanded);
                  return def ? <CustomTile def={def} /> : null;
                })()}
            </div>
          </div>
        </div>
      )}
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

/* ---------------- Réglages ---------------- */

function SettingsView() {
  const [prefs, setPrefs] = useState<Prefs & { user_name?: string; ai_name?: string } | null>(null);
  const [names, setNames] = useState({ user_name: "", ai_name: "" });
  const [saved, setSaved] = useState(false);

  async function refresh() {
    const res = await fetch(`${BACKEND}/api/prefs`);
    const p = await res.json();
    setPrefs(p);
    setNames({ user_name: p.user_name ?? "", ai_name: p.ai_name ?? "" });
  }

  useEffect(() => {
    refresh();
  }, []);

  async function post(body: object) {
    await fetch(`${BACKEND}/api/prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    refresh();
  }

  async function saveNames() {
    await post(names);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!prefs) return <main className="settings"><p className="tile-empty">Chargement…</p></main>;

  const allTiles: { key: string; label: string }[] = [
    ...Object.entries(TILE_LABELS).map(([key, label]) => ({ key, label })),
    ...prefs.custom.map((c) => ({ key: `custom:${c.id}`, label: `📌 ${c.title}` })),
  ];

  return (
    <main className="settings">
      <div className="tile">
        <h3>👤 Personnalisation</h3>
        <div className="settings-row">
          <label>
            Ton prénom (l'IA t'appellera ainsi)
            <input
              value={names.user_name}
              onChange={(e) => setNames({ ...names, user_name: e.target.value })}
            />
          </label>
          <label>
            Nom de l'assistant
            <input
              value={names.ai_name}
              onChange={(e) => setNames({ ...names, ai_name: e.target.value })}
            />
          </label>
          <button className="save-btn" onClick={saveNames}>
            {saved ? "✓ Enregistré" : "Enregistrer"}
          </button>
        </div>
      </div>

      <div className="tile">
        <h3>🧩 Mes tuiles</h3>
        <p className="tile-empty" style={{ marginBottom: 12 }}>
          Active ou désactive chaque tuile de l'accueil. L'ordre se règle par glisser-déposer
          sur l'accueil.
        </p>
        <ul className="tile-toggles">
          {allTiles.map(({ key, label }) => {
            const active = prefs.tiles.includes(key);
            return (
              <li key={key}>
                <span>{label}</span>
                <button
                  className={`switch ${active ? "on" : ""}`}
                  onClick={() => post(active ? { hide_tile: key } : { show_tile: key })}
                  aria-label={active ? "Désactiver" : "Activer"}
                >
                  <span className="knob" />
                </button>
              </li>
            );
          })}
        </ul>
        <button
          className="reset-btn"
          onClick={() => {
            if (confirm("Rétablir les tuiles, l'ordre et les tailles par défaut ?")) {
              post({ reset_tiles: true });
            }
          }}
        >
          ↩ Rétablir les tuiles par défaut
        </button>
      </div>
    </main>
  );
}

/* ---------------- App ---------------- */

function Splash() {
  return (
    <div className="app-splash">
      <img src="/kabrig-logo.png" alt="Kabrig" />
      <div className="splash-bar" />
      <div className="splash-txt">Chargement de Kabrig…</div>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("accueil");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [health, setHealth] = useState<{ ollama: boolean; models: string[] } | null>(null);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  // Écran de chargement à chaque ouverture / F5, jusqu'à ce que les tuiles du
  // dashboard soient remplies (HomeView appelle onLoaded). Filet de sécurité à
  // 12 s pour ne jamais rester bloqué (ex. backend lent/absent).
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 12000);
    return () => clearTimeout(t);
  }, []);

  async function refreshChats() {
    const res = await fetch(`${BACKEND}/api/chats`);
    setChats((await res.json()).chats);
  }

  useEffect(() => {
    refreshChats().catch(() => {});
  }, []);

  // Sauvegarde automatique à la fin de chaque réponse.
  useEffect(() => {
    if (busy || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant" || !last.content) return;
    (async () => {
      const res = await fetch(`${BACKEND}/api/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: chatId, messages }),
      });
      const saved = await res.json();
      setChatId(saved.id);
      refreshChats();
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  function newChat() {
    setMessages([]);
    setChatId(null);
    setPendingPrompt("");
  }

  async function openChat(id: number) {
    const res = await fetch(`${BACKEND}/api/chats/${id}`);
    const chat = await res.json();
    setMessages(chat.messages ?? []);
    setChatId(chat.id);
    setTab("chat");
  }


  const [theme, setTheme] = useState<"light" | "dark" | "blue">(
    () => (localStorage.getItem("kabrig-theme") as "light" | "dark" | "blue") || "light"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("kabrig-theme", theme);
  }, [theme]);

  useEffect(() => {
    const check = () =>
      fetch(`${BACKEND}/api/health`)
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => setHealth({ ollama: false, models: [] }));
    check();
    // Vérifie le statut toutes les 8 s (passe de "Hors ligne" à "En ligne" dès
    // que le backend répond, sans avoir à rafraîchir).
    const id = setInterval(check, 8000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", check);
    };
  }, []);

  function goChat(prompt: string) {
    setPendingPrompt(prompt);
    setTab("chat");
  }

  if (!ready) return <Splash />;

  return (
    <div className="app">
      <header>
        <h1>
          <Logo />
        </h1>
        <nav>
          {(["accueil", "chat", "agenda", "reglages"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "accueil" ? "Accueil" : t === "chat" ? "Chat" : t === "agenda" ? "Agenda" : "⚙️"}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <TitleMark />
          <button
            className="theme-toggle"
            onClick={() =>
              setTheme((t) => (t === "light" ? "dark" : t === "dark" ? "blue" : "light"))
            }
            title="Changer de thème (clair / sombre / bleu)"
          >
            {theme === "light" ? "☀️" : theme === "dark" ? "🌙" : "🦁"}
          </button>
          <span className={`status ${health?.ollama ? "ok" : "ko"}`}>
            {health === null ? "…" : health.ollama ? "En ligne" : "Hors ligne"}
          </span>
        </div>
      </header>

      <HomeView goChat={goChat} active={tab === "accueil"} onLoaded={() => setReady(true)} />
      {tab === "chat" && (
        <div className="chat-layout">
          <div className="chat-main">
            <ChatView
              messages={messages}
              setMessages={setMessages}
              busy={busy}
              setBusy={setBusy}
              initialInput={pendingPrompt}
              key={pendingPrompt /* remount pour préremplir */}
            />
          </div>
          <aside className="chat-side">
            <button className="new-chat" onClick={newChat}>
              ➕ Nouvelle conversation
            </button>
            <div className="chat-list">
              {chats.length === 0 && <p className="tile-empty">Aucune conversation sauvegardée.</p>}
              {chats.map((c) => (
                <div
                  key={c.id}
                  className={`chat-item ${chatId === c.id ? "active" : ""}`}
                  onClick={() => openChat(c.id)}
                >
                  <div className="chat-item-title">{c.title}</div>
                  <div className="chat-item-date">{c.updated_at.slice(0, 10)}</div>
                  <button
                    className="chat-item-del"
                    title="Supprimer"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Supprimer « ${c.title} » ?`)) return;
                      const res = await fetch(`${BACKEND}/api/chats/${c.id}`, { method: "DELETE" });
                      setChats((await res.json()).chats);
                      if (chatId === c.id) newChat();
                    }}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
      {tab === "agenda" && <AgendaView />}
      {tab === "reglages" && <SettingsView />}
    </div>
  );
}

export default App;
