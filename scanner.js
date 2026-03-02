const fetch = require("node-fetch");

const TWELVE_KEY = "50a9c7694aba489189b92f22ce0963eb";
const SUPABASE_URL = "https://aoetvpbeardgblwxfvvr.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFvZXR2cGJlYXJkZ2Jsd3hmdnZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0Mjk1MzgsImV4cCI6MjA4ODAwNTUzOH0.KdPJnvpKn9ucdy998oUXV6jap7XxERXGtzBrn-XjbdA";

const ASSETS = [
  { symbol: "QQQ", short: "QQQ" },
  { symbol: "XAU/USD", short: "XAUUSD" },
];
const TIMEFRAMES = [
  { interval: "1h", type: "Intraday" },
  { interval: "1day", type: "Swing" },
];

// Track already-fired signals to avoid duplicates
const firedKeys = new Set();

function calcResistance(candles, n = 5) {
  const levels = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i].high;
    if (h > candles[i-1].high && h > candles[i-2].high && h > candles[i+1].high && h > candles[i+2].high)
      levels.push(parseFloat(h.toFixed(4)));
  }
  return [...new Set(levels)].sort((a,b) => b-a).slice(0, n);
}
function calcSupport(candles, n = 5) {
  const levels = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const l = candles[i].low;
    if (l < candles[i-1].low && l < candles[i-2].low && l < candles[i+1].low && l < candles[i+2].low)
      levels.push(parseFloat(l.toFixed(4)));
  }
  return [...new Set(levels)].sort((a,b) => a-b).slice(0, n);
}
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i-1].close;
    trs.push(Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc)));
  }
  return trs.slice(-period).reduce((a,b) => a+b, 0) / period;
}
function detectSignals(price, resistance, support, atr, tfType) {
  const signals = [];
  const threshold = atr ? atr * 0.5 : price * 0.003;
  for (const r of resistance) {
    if (Math.abs(price - r) <= threshold && price < r)
      signals.push({ direction:"SHORT", entry:parseFloat(price.toFixed(4)), sl:parseFloat((r+atr*1.5).toFixed(4)), tp:parseFloat((price-atr*2.5).toFixed(4)), level:r, reason:`Retesting resistance at ${r.toFixed(4)}`, timeframe:tfType });
  }
  for (const s of support) {
    if (Math.abs(price - s) <= threshold && price > s)
      signals.push({ direction:"LONG", entry:parseFloat(price.toFixed(4)), sl:parseFloat((s-atr*1.5).toFixed(4)), tp:parseFloat((price+atr*2.5).toFixed(4)), level:s, reason:`Retesting support at ${s.toFixed(4)}`, timeframe:tfType });
  }
  return signals;
}

async function saveSignal(sig, asset) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/signals`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      asset, direction: sig.direction, timeframe: sig.timeframe,
      entry: sig.entry, sl: sig.sl, tp: sig.tp,
      level: sig.level, reason: sig.reason, outcome: "PENDING",
    }),
  });
  if (!res.ok) console.error("Supabase error:", await res.text());
  else console.log(`✅ Saved: ${asset} ${sig.direction} @ ${sig.entry} (${sig.timeframe})`);
}

async function scan() {
  console.log(`\n🔍 Scanning... ${new Date().toLocaleTimeString()}`);
  for (const asset of ASSETS) {
    try {
      const priceRes = await fetch(`https://api.twelvedata.com/price?symbol=${asset.symbol}&apikey=${TWELVE_KEY}`);
      const priceJson = await priceRes.json();
      const price = parseFloat(priceJson.price);
      if (!price) { console.log(`⚠️ No price for ${asset.symbol}`); continue; }

      for (const tf of TIMEFRAMES) {
        const res = await fetch(`https://api.twelvedata.com/time_series?symbol=${asset.symbol}&interval=${tf.interval}&outputsize=60&apikey=${TWELVE_KEY}`);
        const json = await res.json();
        if (!json.values) continue;

        const candles = json.values.map(c => ({
          high: parseFloat(c.high), low: parseFloat(c.low),
          close: parseFloat(c.close), open: parseFloat(c.open),
        })).reverse();

        const resistance = calcResistance(candles);
        const support = calcSupport(candles);
        const atr = calcATR(candles);
        const signals = detectSignals(price, resistance, support, atr, tf.type);

        for (const sig of signals) {
          const key = `${asset.short}-${sig.direction}-${sig.level}-${sig.timeframe}`;
          if (!firedKeys.has(key)) {
            firedKeys.add(key);
            await saveSignal(sig, asset.short);
          }
        }
        // Small delay to avoid API rate limits
        await new Promise(r => setTimeout(r, 500));
      }
    } catch(e) {
      console.error(`Error scanning ${asset.symbol}:`, e.message);
    }
  }
}

// Run immediately then every 60 seconds
scan();
setInterval(scan, 60000);
console.log("🚀 Trade scanner running...");
```

---

**File 3 — `Procfile`** (no extension, just `Procfile`)
```
web: node scanner.js
