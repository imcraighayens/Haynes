"""
TradingAgents local web server — FastAPI + SSE streaming
"""
import asyncio
import json
import os
from datetime import date, datetime
from typing import Optional

from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from tradingagents.default_config import DEFAULT_CONFIG

app = FastAPI(title="TradingAgents", version="0.2.5")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory job store ──────────────────────────────────────────────────────
_jobs: dict[str, dict] = {}


class AnalyzeRequest(BaseModel):
    ticker: str
    date: str  # YYYY-MM-DD
    llm_provider: str = "openai"
    deep_think_llm: str = "gpt-4o"
    quick_think_llm: str = "gpt-4o-mini"
    analysts: list[str] = ["market", "social", "news", "fundamentals"]
    max_debate_rounds: int = 1
    max_risk_rounds: int = 1


# ── HTML UI ──────────────────────────────────────────────────────────────────
HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TradingAgents</title>
<style>
  :root{--bg:#0f1117;--card:#1a1d27;--border:#2a2d3e;--accent:#6c8ef5;--green:#4ade80;--red:#f87171;--yellow:#fbbf24;--text:#e2e8f0;--muted:#64748b}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;min-height:100vh}
  header{background:var(--card);border-bottom:1px solid var(--border);padding:1rem 2rem;display:flex;align-items:center;gap:.75rem}
  header h1{font-size:1.25rem;font-weight:700;color:var(--accent)}
  header span{font-size:.8rem;color:var(--muted);background:var(--border);padding:.2rem .5rem;border-radius:99px}
  main{max-width:900px;margin:2rem auto;padding:0 1rem}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.5rem;margin-bottom:1.5rem}
  .card h2{font-size:.9rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:1rem}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
  label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:.3rem}
  input,select{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:.6rem .75rem;color:var(--text);font-size:.9rem;outline:none;transition:border-color .2s}
  input:focus,select:focus{border-color:var(--accent)}
  .analysts{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.25rem}
  .analyst-btn{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.35rem .75rem;font-size:.8rem;cursor:pointer;transition:all .2s;color:var(--muted)}
  .analyst-btn.active{background:var(--accent);border-color:var(--accent);color:#fff}
  button.run{width:100%;background:var(--accent);border:none;border-radius:8px;padding:.75rem;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer;transition:opacity .2s;margin-top:.5rem}
  button.run:disabled{opacity:.5;cursor:not-allowed}
  #output{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:1rem;font-family:'Fira Mono',monospace;font-size:.8rem;line-height:1.6;height:340px;overflow-y:auto;white-space:pre-wrap;color:#94a3b8}
  .decision-box{border-radius:8px;padding:1rem 1.25rem;font-weight:700;font-size:1.1rem;text-align:center;margin-top:1rem;display:none}
  .decision-box.buy{background:#052e16;border:1px solid var(--green);color:var(--green)}
  .decision-box.sell{background:#2d0a0a;border:1px solid var(--red);color:var(--red)}
  .decision-box.hold{background:#2d1f00;border:1px solid var(--yellow);color:var(--yellow)}
  .status{font-size:.78rem;color:var(--muted);margin-top:.5rem;text-align:right}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-right:.4rem;vertical-align:middle}
  .dot.running{background:var(--accent);animation:pulse 1s infinite}
  .dot.done{background:var(--green)}
  .dot.error{background:var(--red)}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style>
</head>
<body>
<header>
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent)"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
  <h1>TradingAgents</h1>
  <span>v0.2.5</span>
</header>
<main>
  <div class="card">
    <h2>Analysis Setup</h2>
    <div class="grid">
      <div>
        <label>Ticker Symbol</label>
        <input id="ticker" type="text" placeholder="e.g. AAPL, NVDA, TSLA" value="NVDA">
      </div>
      <div>
        <label>Analysis Date</label>
        <input id="date" type="date" value="">
      </div>
      <div>
        <label>LLM Provider</label>
        <select id="provider">
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google Gemini</option>
          <option value="deepseek">DeepSeek</option>
          <option value="ollama">Ollama (local)</option>
        </select>
      </div>
      <div>
        <label>Deep Think Model</label>
        <input id="deep_model" type="text" placeholder="e.g. gpt-4o" value="gpt-4o">
      </div>
    </div>
    <div style="margin-top:1rem">
      <label>Analyst Team</label>
      <div class="analysts">
        <button class="analyst-btn active" data-analyst="market">Market</button>
        <button class="analyst-btn active" data-analyst="social">Sentiment</button>
        <button class="analyst-btn active" data-analyst="news">News</button>
        <button class="analyst-btn active" data-analyst="fundamentals">Fundamentals</button>
      </div>
    </div>
    <button class="run" id="runBtn" onclick="runAnalysis()">Run Analysis</button>
  </div>

  <div class="card">
    <h2>Live Output <span class="dot" id="dot"></span></h2>
    <div id="output">Ready. Configure your analysis above and click Run.</div>
    <div class="decision-box" id="decisionBox"></div>
    <div class="status" id="statusLine"></div>
  </div>
</main>
<script>
  // Set default date to today
  document.getElementById('date').value = new Date().toISOString().split('T')[0];

  document.querySelectorAll('.analyst-btn').forEach(btn => {
    btn.onclick = () => btn.classList.toggle('active');
  });

  let es = null;

  async function runAnalysis() {
    const ticker = document.getElementById('ticker').value.trim().toUpperCase();
    const dt = document.getElementById('date').value;
    const provider = document.getElementById('provider').value;
    const deepModel = document.getElementById('deep_model').value.trim();
    const analysts = [...document.querySelectorAll('.analyst-btn.active')].map(b => b.dataset.analyst);

    if (!ticker || !dt) { alert('Please enter a ticker and date.'); return; }
    if (analysts.length === 0) { alert('Select at least one analyst.'); return; }

    // Check for API key
    const keyEnv = {openai:'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY',google:'GOOGLE_API_KEY',deepseek:'DEEPSEEK_API_KEY',ollama:null};

    const out = document.getElementById('output');
    const dot = document.getElementById('dot');
    const box = document.getElementById('decisionBox');
    const btn = document.getElementById('runBtn');
    const status = document.getElementById('statusLine');

    out.textContent = '';
    box.style.display = 'none';
    box.className = 'decision-box';
    dot.className = 'dot running';
    btn.disabled = true;
    status.textContent = 'Starting analysis…';

    if (es) es.close();

    const params = new URLSearchParams({
      ticker, date: dt, llm_provider: provider,
      deep_think_llm: deepModel,
      quick_think_llm: deepModel.includes('4o') ? deepModel.replace('4o','4o-mini') : deepModel,
      analysts: analysts.join(','),
    });

    es = new EventSource(`/stream?${params}`);

    es.addEventListener('log', e => {
      const d = JSON.parse(e.data);
      out.textContent += d.text;
      out.scrollTop = out.scrollHeight;
    });

    es.addEventListener('decision', e => {
      const d = JSON.parse(e.data);
      const action = (d.action || '').toUpperCase();
      box.textContent = `Decision: ${action}`;
      const cls = action === 'BUY' ? 'buy' : action === 'SELL' ? 'sell' : 'hold';
      box.className = `decision-box ${cls}`;
      box.style.display = 'block';
    });

    es.addEventListener('done', e => {
      dot.className = 'dot done';
      btn.disabled = false;
      status.textContent = 'Analysis complete — ' + new Date().toLocaleTimeString();
      es.close();
    });

    es.addEventListener('error', e => {
      const msg = e.data ? JSON.parse(e.data).error : 'Connection error';
      out.textContent += '\\n\\n[ERROR] ' + msg;
      dot.className = 'dot error';
      btn.disabled = false;
      status.textContent = 'Error — check logs';
      es.close();
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      dot.className = 'dot error';
      btn.disabled = false;
      status.textContent = 'Stream closed unexpectedly';
    };
  }
</script>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTML


@app.get("/stream")
async def stream_analysis(
    ticker: str,
    date: str,
    llm_provider: str = "openai",
    deep_think_llm: str = "gpt-4o",
    quick_think_llm: str = "gpt-4o-mini",
    analysts: str = "market,social,news,fundamentals",
    max_debate_rounds: int = 1,
    max_risk_rounds: int = 1,
):
    analyst_list = [a.strip() for a in analysts.split(",") if a.strip()]

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()

        def log(text: str):
            asyncio.get_event_loop().call_soon_threadsafe(
                queue.put_nowait, ("log", {"text": text})
            )

        async def run():
            try:
                from tradingagents.graph.trading_graph import TradingAgentsGraph

                config = DEFAULT_CONFIG.copy()
                config.update(
                    {
                        "llm_provider": llm_provider,
                        "deep_think_llm": deep_think_llm,
                        "quick_think_llm": quick_think_llm,
                        "max_debate_rounds": max_debate_rounds,
                        "max_risk_discuss_rounds": max_risk_rounds,
                        "selected_analysts": analyst_list,
                    }
                )

                await queue.put(
                    ("log", {"text": f"Initialising TradingAgents [{llm_provider}]…\n"})
                )
                await queue.put(
                    ("log", {"text": f"Ticker: {ticker.upper()}  |  Date: {date}\n"})
                )
                await queue.put(
                    (
                        "log",
                        {"text": f"Analysts: {', '.join(analyst_list)}\n\n"},
                    )
                )

                loop = asyncio.get_event_loop()
                ta = await loop.run_in_executor(
                    None, lambda: TradingAgentsGraph(debug=False, config=config)
                )

                await queue.put(("log", {"text": "Graph initialised. Running propagation…\n\n"}))

                # Run propagate in thread executor (it's synchronous/blocking)
                def _propagate():
                    return ta.propagate(ticker.upper(), date, analyst_list)

                state, decision = await loop.run_in_executor(None, _propagate)

                await queue.put(("log", {"text": "\n─── Final Decision ─────────────────────────\n"}))
                await queue.put(("log", {"text": str(decision) + "\n"}))

                # Try to extract action keyword
                decision_str = str(decision).upper()
                action = "HOLD"
                if "BUY" in decision_str:
                    action = "BUY"
                elif "SELL" in decision_str:
                    action = "SELL"

                await queue.put(("decision", {"action": action, "raw": str(decision)}))
                await queue.put(("done", {}))

            except Exception as exc:
                await queue.put(("error", {"error": str(exc)}))
            finally:
                await queue.put(None)  # sentinel

        asyncio.create_task(run())

        while True:
            item = await queue.get()
            if item is None:
                break
            event, data = item
            yield f"event: {event}\ndata: {json.dumps(data)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.2.5"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 7860))
    print(f"\n  TradingAgents server → http://localhost:{port}\n")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
