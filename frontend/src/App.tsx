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

type Prefs = {
  city: string;
  sports: string[];
  tiles: string[];
  spotify: string;
  sizes: Record<string, "s" | "m" | "l">;
  custom: { id: string; title: string; query: string }[];
};

type NewsItem = { title: string; url: string; source: string };

type Dashboard = {
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

  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/spotify/status`)
      .then((r) => r.json())
      .then(setSpotify)
      .catch(() => setSpotify(null));
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

  async function connectSpotify() {
    const res = await fetch(`${BACKEND}/api/spotify/login`);
    const json = await res.json();
    if (json.error) {
      alert(json.error);
      return;
    }
    if (isTauri) openUrl(json.url);
    else window.open(json.url, "_blank");
  }

  async function cycleSize(tile: string) {
    const order: ("s" | "m" | "l")[] = ["m", "l", "s"];
    const current = data?.prefs.sizes?.[tile] ?? "m";
    const next = order[(order.indexOf(current) + 1) % order.length];
    const sizes = { ...(data?.prefs.sizes ?? {}), [tile]: next };
    await fetch(`${BACKEND}/api/prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sizes }),
    });
    setData((d) => (d ? { ...d, prefs: { ...d.prefs, sizes } } : d));
  }

  const [dragKey, setDragKey] = useState<string | null>(null);
  const dataRef = useRef<Dashboard | null>(null);
  dataRef.current = data;

  function tileClass(tile: string) {
    return `tile size-${data?.prefs.sizes?.[tile] ?? "m"}${dragKey === tile ? " dragging" : ""}`;
  }

  function dragProps(tile: string) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        // Pas de drag depuis les zones interactives (inputs, boutons, carte, player).
        const el = e.target as HTMLElement;
        if (el.closest("input, button, a, iframe, .route-map")) {
          e.preventDefault();
          return;
        }
        setDragKey(tile);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragEnd: async () => {
        // Fin du drag (où qu'il se termine) : on persiste l'ordre courant.
        setDragKey(null);
        const order = dataRef.current?.prefs.tiles;
        if (!order) return;
        await fetch(`${BACKEND}/api/prefs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tiles: order }),
        });
      },
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        // Insertion en direct : la tuile déplacée prend la place survolée,
        // les autres se décalent immédiatement.
        if (!dragKey || dragKey === tile) return;
        setData((d) => {
          if (!d) return d;
          const order = [...d.prefs.tiles];
          const from = order.indexOf(dragKey);
          const to = order.indexOf(tile);
          if (from === -1 || to === -1 || from === to) return d;
          order.splice(from, 1);
          order.splice(to, 0, dragKey);
          return { ...d, prefs: { ...d.prefs, tiles: order } };
        });
      },
      onDrop: (e: React.DragEvent) => e.preventDefault(),
    };
  }

  function SizeBtn({ tile }: { tile: string }) {
    const size = data?.prefs.sizes?.[tile] ?? "m";
    return (
      <button className="size-btn" title="Taille (petit/moyen/grand)" onClick={() => cycleSize(tile)}>
        {size.toUpperCase()}
      </button>
    );
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
              <section className={tileClass(t)} key={t} {...dragProps(t)}>
                <h3>🌤️ Météo <SizeBtn tile={t} /></h3>
                {weather && weather.city ? (
                  <WeatherCard data={weather} />
                ) : (
                  <p className="tile-empty">{loading ? "Chargement…" : "Indisponible"}</p>
                )}
              </section>
            );
          if (t === "agenda")
            return (
              <section className={tileClass(t)} key={t} {...dragProps(t)}>
                <h3>📅 Agenda <SizeBtn tile={t} /></h3>
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
              <section className={tileClass(t)} key={t} {...dragProps(t)}>
                <h3>🏉 Sport <SizeBtn tile={t} /></h3>
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
              <section className={tileClass(t)} key={t} {...dragProps(t)}>
                <h3>
                  📬 Boîte mail
                  {data?.mail?.configured && <span className="badge">{data.mail.unread} non lus</span>}
                  <SizeBtn tile={t} />
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
              <section className={tileClass(t)} key={t} {...dragProps(t)}>
                <h3>🎵 Spotify <SizeBtn tile={t} /></h3>
                {spotify?.configured && !spotify.connected && (
                  <button className="wa-btn spotify-connect" onClick={connectSpotify}>
                    Connecter mon compte Spotify
                  </button>
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
              </section>
            );
          }
          if (t === "whatsapp")
            return (
              <section className={tileClass(t)} key={t} {...dragProps(t)}>
                <h3>💬 WhatsApp <SizeBtn tile={t} /></h3>
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
              <section className={tileClass(t)} key={t} {...dragProps(t)}>
                <h3>🎉 Idées de sortie <SizeBtn tile={t} /></h3>
                {data?.sorties ? (
                  <div className="tile-md">
                    <Markdown components={{ a: ExternalLink }}>{data.sorties}</Markdown>
                  </div>
                ) : (
                  <p className="tile-empty">{loading ? "Chargement…" : "Aucune suggestion."}</p>
                )}
              </section>
            );
          if (t.startsWith("custom:")) {
            const id = t.slice(7);
            const def = data?.prefs.custom.find((c) => c.id === id);
            const items = data?.custom?.[id] ?? [];
            return (
              <section className={tileClass(t)} key={t} {...dragProps(t)}>
                <h3>
                  📌 {def?.title ?? id} <SizeBtn tile={t} />
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
                  <p className="tile-empty">{loading ? "Chargement…" : "Aucune actu trouvée."}</p>
                )}
              </section>
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
