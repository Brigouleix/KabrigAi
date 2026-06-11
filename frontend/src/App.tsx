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

type Tab = "accueil" | "chat" | "agenda" | "reglages";

const TILE_LABELS: Record<string, string> = {
  weather: "🌤️ Météo",
  agenda: "📅 Agenda",
  sport: "🏉 Sport",
  sorties: "🎉 Idées de sortie",
  mail: "📬 Boîte mail",
  spotify: "🎵 Spotify",
  whatsapp: "💬 WhatsApp",
};

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
            {m.tools?.map((t, j) => (
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

/* ---------------- Accueil ---------------- */

// Tuile à hauteur automatique : mesure son contenu et occupe exactement
// le nombre de rangées nécessaires dans la grille (pas de vide).
function Tile({
  className,
  drag,
  children,
}: {
  className: string;
  drag: React.HTMLAttributes<HTMLElement>;
  children: React.ReactNode;
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
    <section ref={secRef} className={className} {...drag}>
      <div ref={innerRef}>{children}</div>
    </section>
  );
}

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
  const [overKey, setOverKey] = useState<string | null>(null);

  function tileClass(tile: string) {
    const dropping = overKey === tile && dragKey && dragKey !== tile ? " drop-target" : "";
    return `tile size-${data?.prefs.sizes?.[tile] ?? "m"}${dragKey === tile ? " dragging" : ""}${dropping}`;
  }

  // NB : ne PAS réordonner le DOM pendant le drag — Chrome/WebView2 annule le
  // drag si l'élément source bouge. On marque la cible, on insère au drop.
  function dragProps(tile: string) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        const el = e.target as HTMLElement;
        if (el.closest("input, button, a, iframe, .route-map")) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("text/plain", tile);
        e.dataTransfer.effectAllowed = "move";
        setDragKey(tile);
      },
      onDragEnd: () => {
        setDragKey(null);
        setOverKey(null);
      },
      onDragOver: (e: React.DragEvent) => {
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
              <Tile className={tileClass(t)} key={t} drag={dragProps(t)}>
                <h3>🌤️ Météo <SizeBtn tile={t} /></h3>
                {weather && weather.city ? (
                  <WeatherCard data={weather} />
                ) : (
                  <p className="tile-empty">{loading ? "Chargement…" : "Indisponible"}</p>
                )}
              </Tile>
            );
          if (t === "agenda")
            return (
              <Tile className={tileClass(t)} key={t} drag={dragProps(t)}>
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
              </Tile>
            );
          if (t === "sport")
            return (
              <Tile className={tileClass(t)} key={t} drag={dragProps(t)}>
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
              </Tile>
            );
          if (t === "mail")
            return (
              <Tile className={tileClass(t)} key={t} drag={dragProps(t)}>
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
              </Tile>
            );
          if (t === "spotify") {
            const embed = data ? spotifyEmbedUrl(data.prefs.spotify) : null;
            return (
              <Tile className={tileClass(t)} key={t} drag={dragProps(t)}>
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
              </Tile>
            );
          }
          if (t === "whatsapp")
            return (
              <Tile className={tileClass(t)} key={t} drag={dragProps(t)}>
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
              <Tile className={tileClass(t)} key={t} drag={dragProps(t)}>
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
            const def = data?.prefs.custom.find((c) => c.id === id);
            const items = data?.custom?.[id] ?? [];
            return (
              <Tile className={tileClass(t)} key={t} drag={dragProps(t)}>
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

function App() {
  const [tab, setTab] = useState<Tab>("accueil");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [health, setHealth] = useState<{ ollama: boolean; models: string[] } | null>(null);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);

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
          {(["accueil", "chat", "agenda", "reglages"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "accueil" ? "Accueil" : t === "chat" ? "Chat" : t === "agenda" ? "Agenda" : "⚙️"}
            </button>
          ))}
        </nav>
        <span className={`status ${health?.ollama ? "ok" : "ko"}`}>
          {health === null ? "…" : health.ollama ? "En ligne" : "Hors ligne"}
        </span>
      </header>

      {tab === "accueil" && <HomeView goChat={goChat} />}
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
