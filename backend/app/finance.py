"""Données et indicateurs financiers : crypto (CoinGecko) et bourse (Yahoo).

Les tools renvoient données + indicateurs calculés ; l'analyse et les
recommandations sont produites par le LLM (croisées avec web_search).
"""
import statistics

import httpx

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KabrigAI/1.0"}


# ---------- Indicateurs ----------

def _pct(a: float, b: float) -> float:
    return round((a - b) / b * 100, 2) if b else 0.0


def _sma(prices: list[float], n: int) -> float | None:
    return round(statistics.mean(prices[-n:]), 4) if len(prices) >= n else None


def _rsi(prices: list[float], n: int = 14) -> float | None:
    if len(prices) < n + 1:
        return None
    gains, losses = [], []
    for prev, cur in zip(prices[-n - 1 : -1], prices[-n:]):
        delta = cur - prev
        gains.append(max(delta, 0))
        losses.append(max(-delta, 0))
    avg_loss = statistics.mean(losses)
    if avg_loss == 0:
        return 100.0
    rs = statistics.mean(gains) / avg_loss
    return round(100 - 100 / (1 + rs), 1)


def _volatility(prices: list[float]) -> float | None:
    if len(prices) < 8:
        return None
    returns = [(b - a) / a for a, b in zip(prices, prices[1:]) if a]
    return round(statistics.stdev(returns) * (365 ** 0.5) * 100, 1)


def _max_drawdown(prices: list[float]) -> float:
    peak, mdd = prices[0], 0.0
    for p in prices:
        peak = max(peak, p)
        mdd = min(mdd, (p - peak) / peak)
    return round(mdd * 100, 1)


def _indicators(prices: list[float]) -> dict:
    last = prices[-1]
    out = {
        "prix_actuel": round(last, 4),
        "variation_7j_pct": _pct(last, prices[-8]) if len(prices) >= 8 else None,
        "variation_30j_pct": _pct(last, prices[-31]) if len(prices) >= 31 else None,
        "variation_periode_pct": _pct(last, prices[0]),
        "plus_haut_periode": round(max(prices), 4),
        "plus_bas_periode": round(min(prices), 4),
        "sma_20": _sma(prices, 20),
        "sma_50": _sma(prices, 50),
        "rsi_14": _rsi(prices),
        "volatilite_annualisee_pct": _volatility(prices),
        "drawdown_max_pct": _max_drawdown(prices),
    }
    if out["sma_50"]:
        out["tendance"] = "haussière (prix > SMA50)" if last > out["sma_50"] else "baissière (prix < SMA50)"
    return out


def _format(name: str, currency: str, ind: dict, extra: dict | None = None) -> str:
    lines = [f"=== {name} ({currency}) ==="]
    for k, v in (extra or {}).items():
        lines.append(f"{k} : {v}")
    for k, v in ind.items():
        if v is not None:
            lines.append(f"{k} : {v}")
    return "\n".join(lines)


# ---------- Crypto (CoinGecko, sans clé) ----------

def _chart_widget(title: str, labels: list[str], series: list[dict], kind: str = "line") -> dict:
    return {
        "widget": "chart",
        "data": {"title": title, "labels": labels, "series": series, "type": kind},
    }


async def crypto_data(coins: str, days: int = 90) -> tuple[str, dict | None]:
    """coins : ids CoinGecko séparés par des virgules (bitcoin, ethereum, solana...)."""
    ids = [c.strip().lower() for c in coins.split(",") if c.strip()][:5]
    results = []
    chart_series: list[dict] = []
    chart_labels: list[str] = []
    async with httpx.AsyncClient(timeout=20, headers=UA) as client:
        markets = await client.get(
            "https://api.coingecko.com/api/v3/coins/markets",
            params={"vs_currency": "eur", "ids": ",".join(ids)},
        )
        market_by_id = {m["id"]: m for m in markets.json()} if markets.status_code == 200 else {}
        for cid in ids:
            r = await client.get(
                f"https://api.coingecko.com/api/v3/coins/{cid}/market_chart",
                params={"vs_currency": "eur", "days": days, "interval": "daily"},
            )
            if r.status_code != 200:
                results.append(f"=== {cid} === introuvable sur CoinGecko (id exact requis, ex: bitcoin)")
                continue
            raw = r.json().get("prices", [])
            prices = [p[1] for p in raw]
            if len(prices) < 2:
                continue
            from datetime import datetime

            if not chart_labels:
                chart_labels = [
                    datetime.fromtimestamp(p[0] / 1000).strftime("%d/%m") for p in raw
                ]
            chart_series.append({"name": cid, "values": [round(p, 4) for p in prices]})
            m = market_by_id.get(cid, {})
            extra = {}
            if m:
                extra = {
                    "rang_capitalisation": m.get("market_cap_rank"),
                    "capitalisation_eur": f"{m.get('market_cap', 0):,}".replace(",", " "),
                    "volume_24h_eur": f"{m.get('total_volume', 0):,}".replace(",", " "),
                    "variation_24h_pct": m.get("price_change_percentage_24h"),
                    "ath_eur": m.get("ath"),
                    "distance_ath_pct": m.get("ath_change_percentage"),
                }
            results.append(_format(m.get("name", cid), "EUR", _indicators(prices), extra))
    widget = None
    if chart_series:
        if len(chart_series) > 1:
            # Échelles différentes : on normalise en base 100 pour comparer.
            for s in chart_series:
                base = s["values"][0]
                s["values"] = [round(v / base * 100, 2) for v in s["values"]]
            title = f"Comparaison base 100 — {days}j"
        else:
            title = f"{chart_series[0]['name']} (EUR) — {days}j"
        widget = _chart_widget(title, chart_labels, chart_series)
    return f"Données sur {days} jours :\n\n" + "\n\n".join(results), widget


# ---------- Bourse (Yahoo Finance, sans clé) ----------

async def stock_data(symbol: str, range: str = "6mo") -> tuple[str, dict | None]:
    """symbol : ticker Yahoo (AAPL, MC.PA, ^FCHI pour le CAC 40, EURUSD=X...)."""
    async with httpx.AsyncClient(timeout=20, headers=UA) as client:
        r = await client.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"range": range, "interval": "1d"},
        )
    if r.status_code != 200:
        return f"Ticker introuvable : {symbol} (format Yahoo : AAPL, MC.PA, ^FCHI, BTC-EUR...)", None
    data = r.json().get("chart", {}).get("result", [None])[0]
    if not data:
        return f"Pas de données pour {symbol}.", None
    meta = data["meta"]
    quotes = data["indicators"]["quote"][0]["close"]
    stamps = data.get("timestamp", [])
    pairs = [(t, c) for t, c in zip(stamps, quotes) if c is not None]
    closes = [c for _, c in pairs]
    if len(closes) < 2:
        return f"Historique insuffisant pour {symbol}.", None
    extra = {
        "nom": meta.get("longName") or meta.get("shortName") or symbol,
        "place": meta.get("fullExchangeName", ""),
        "plus_haut_52_semaines": meta.get("fiftyTwoWeekHigh"),
        "plus_bas_52_semaines": meta.get("fiftyTwoWeekLow"),
    }
    from datetime import datetime

    labels = [datetime.fromtimestamp(t).strftime("%d/%m") for t, _ in pairs]
    widget = _chart_widget(
        f"{extra['nom']} ({meta.get('currency', '')}) — {range}",
        labels,
        [{"name": symbol, "values": [round(c, 2) for c in closes]}],
    )
    return (
        f"Données sur {range} :\n\n"
        + _format(symbol, meta.get("currency", ""), _indicators(closes), extra)
    ), widget


async def market_overview() -> str:
    """Vue d'ensemble : indices majeurs + top cryptos."""
    indices = {
        "^FCHI": "CAC 40",
        "^GSPC": "S&P 500",
        "^IXIC": "Nasdaq",
        "^STOXX50E": "Euro Stoxx 50",
        "EURUSD=X": "EUR/USD",
        "GC=F": "Or",
        "BZ=F": "Pétrole Brent",
    }
    lines = ["=== Indices & matières premières ==="]
    async with httpx.AsyncClient(timeout=20, headers=UA) as client:
        for sym, name in indices.items():
            try:
                r = await client.get(
                    f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
                    params={"range": "5d", "interval": "1d"},
                )
                d = r.json()["chart"]["result"][0]
                closes = [c for c in d["indicators"]["quote"][0]["close"] if c]
                lines.append(
                    f"{name} : {round(closes[-1], 2)} ({_pct(closes[-1], closes[0]):+}% sur 5j)"
                )
            except Exception:
                lines.append(f"{name} : indisponible")
        try:
            r = await client.get(
                "https://api.coingecko.com/api/v3/coins/markets",
                params={"vs_currency": "eur", "order": "market_cap_desc", "per_page": 8},
            )
            lines.append("\n=== Top cryptos (EUR) ===")
            for m in r.json():
                lines.append(
                    f"{m['name']} : {m['current_price']} € "
                    f"({m.get('price_change_percentage_24h') or 0:+.1f}% 24h)"
                )
        except Exception:
            lines.append("Cryptos : indisponibles")
    return "\n".join(lines)


def create_chart(
    title: str,
    labels: list[str],
    series: list[dict],
    type: str = "line",
) -> tuple[str, dict | None]:
    """Graphique générique fourni par le LLM (line ou bar)."""
    clean = [
        {"name": s.get("name", f"série {i+1}"), "values": [float(v) for v in s.get("values", [])]}
        for i, s in enumerate(series)
        if s.get("values")
    ]
    if not clean or not labels:
        return "Graphique invalide : il faut labels et au moins une série de valeurs.", None
    return (
        f"Graphique « {title} » affiché.",
        _chart_widget(title, [str(l) for l in labels], clean, "bar" if type == "bar" else "line"),
    )


CHART_TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": "create_chart",
        "description": (
            "Affiche un graphique (courbe ou barres) dans le chat à partir de "
            "données que tu fournis. Utile pour visualiser une évolution, une "
            "comparaison, des statistiques. Note : crypto_data et stock_data "
            "affichent déjà automatiquement le graphique des prix."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "labels": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Étiquettes de l'axe X (dates, catégories...)",
                },
                "series": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "values": {"type": "array", "items": {"type": "number"}},
                        },
                        "required": ["name", "values"],
                    },
                    "description": "Une ou plusieurs séries de valeurs (même longueur que labels)",
                },
                "type": {"type": "string", "enum": ["line", "bar"], "description": "Défaut line"},
            },
            "required": ["title", "labels", "series"],
        },
    },
}


FINANCE_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "crypto_data",
            "description": (
                "Données et indicateurs techniques d'une ou plusieurs cryptos "
                "(prix, capitalisation, RSI, SMA, volatilité, drawdown). Pour une "
                "analyse complète, croiser avec web_search pour l'actualité."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "coins": {
                        "type": "string",
                        "description": "Ids CoinGecko séparés par virgules : bitcoin, ethereum, solana, ripple, cardano...",
                    },
                    "days": {"type": "integer", "description": "Historique en jours, défaut 90"},
                },
                "required": ["coins"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "stock_data",
            "description": (
                "Données et indicateurs techniques d'une action, indice, devise ou "
                "matière première via Yahoo Finance. Croiser avec web_search pour "
                "l'actualité de l'entreprise."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {
                        "type": "string",
                        "description": "Ticker Yahoo : AAPL, TSLA, MC.PA (LVMH), TTE.PA (Total), ^FCHI (CAC 40), EURUSD=X, GC=F (or)",
                    },
                    "range": {
                        "type": "string",
                        "enum": ["1mo", "3mo", "6mo", "1y", "2y", "5y"],
                        "description": "Période, défaut 6mo",
                    },
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "market_overview",
            "description": "Vue d'ensemble des marchés : indices majeurs (CAC 40, S&P 500...), or, pétrole, EUR/USD et top cryptos.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]
