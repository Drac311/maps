// ride.js · Firme, tráfico y desnivel de la ruta (datos de OpenStreetMap y Open-Meteo)
(() => {
const COL = {
  surf: { good: '#22c55e', assumed: '#86efac', fair: '#eab308', bad: '#ef4444', unk: '#94a3b8' },
  traf: { seg: '#3b82f6', low: '#22c55e', med: '#eab308', high: '#ef4444', unk: '#94a3b8' }
};
const NAMES = {
  surf: { good: 'Firme bueno', assumed: 'Asfalto (probable)', fair: 'Regular', bad: 'Malo', unk: 'Sin datos' },
  traf: { seg: 'Vía ciclista/peatonal', low: 'Tráfico bajo', med: 'Tráfico medio', high: 'Tráfico alto', unk: 'Sin datos' }
};
const SURF = { asphalt: 0, paved: 0, concrete: 0, 'concrete:plates': 1, 'concrete:lanes': 1, paving_stones: 1, wood: 1, metal: 1, compacted: 1, fine_gravel: 1, sett: 2, cobblestone: 2, gravel: 2, pebblestone: 2, unpaved: 2, unhewn_cobblestone: 3, dirt: 3, earth: 3, ground: 3, mud: 3, sand: 3, grass: 3, rock: 3 };
const SMOOTH = { excellent: 0, good: 0, intermediate: 1, bad: 2, very_bad: 3, horrible: 3, very_horrible: 3, impassable: 3 };
const PAVED = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'cycleway'];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
let layer = 'surf';
const rideGroup = L.layerGroup().addTo(map), warnGroup = L.layerGroup().addTo(map);

function surfClass(t) {
  let v = -1;
  if (has(SMOOTH, t.smoothness)) v = SMOOTH[t.smoothness];
  const s = (t.surface || '').split(';')[0];
  if (has(SURF, s)) v = Math.max(v, SURF[s]);
  if (v < 0) return PAVED.includes(t.highway) ? 'assumed' : 'unk';
  return v === 0 ? 'good' : v === 1 ? 'fair' : 'bad';
}

function trafClass(t) {
  const h = t.highway;
  if (['cycleway', 'path', 'footway', 'pedestrian', 'track', 'bridleway'].includes(h)) return 'seg';
  let lvl = ['motorway', 'trunk', 'primary'].includes(h) ? 3 : ['secondary', 'tertiary'].includes(h) ? 2 : ['residential', 'unclassified', 'service', 'living_street'].includes(h) ? 1 : -1;
  if (lvl < 0) return 'unk';
  if (['cycleway', 'cycleway:left', 'cycleway:right', 'cycleway:both'].some((k) => t[k] && !['no', 'none', 'shoulder'].includes(t[k]))) lvl--;
  return lvl <= 0 ? 'seg' : lvl === 1 ? 'low' : lvl === 2 ? 'med' : 'high';
}

async function fetchWays(routes) {
  const clauses = routes.map((r) => {
    const pts = resample(r.coords, Math.max(0.12, r.distance / 1000 / 350)).map((p) => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(',');
    return `way["highway"](around:18,${pts});`;
  }).join('');
  const q = `[out:json][timeout:30];(${clauses});out tags geom;`;
  const d = await getJSON('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) }, 35000);
  return d.elements.filter((e) => e.geometry && e.tags);
}

function buildIndex(ways) {
  const G = 1500, grid = new Map();
  const add = (lat, lon, wi) => { const k = Math.round(lat * G) + ',' + Math.round(lon * G); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push([lat, lon, wi]); };
  ways.forEach((w, wi) => {
    const g = w.geometry;
    for (let i = 0; i < g.length; i++) {
      add(g[i].lat, g[i].lon, wi);
      if (i) {
        const a = g[i - 1], b = g[i], n = Math.floor((haversine([a.lat, a.lon], [b.lat, b.lon]) * 1000) / 15);
        for (let k = 1; k <= n; k++) add(a.lat + ((b.lat - a.lat) * k) / (n + 1), a.lon + ((b.lon - a.lon) * k) / (n + 1), wi);
      }
    }
  });
  return { grid, G, ways };
}

function nearestWay(ix, lat, lon) {
  const cx = Math.round(lat * ix.G), cy = Math.round(lon * ix.G), cl = Math.cos((lat * Math.PI) / 180);
  let best = -1, bd = 1225;   // 35 m
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const v of ix.grid.get(cx + i + ',' + (cy + j)) || []) {
    const dy = (v[0] - lat) * 111320, dx = (v[1] - lon) * 111320 * cl, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = v[2]; }
  }
  return best;
}

function analyzeOne(r, ix) {
  const pts = resample(r.coords, 0.04), n = pts.length;
  const tags = pts.map((p) => { const wi = nearestWay(ix, p[0], p[1]); return wi < 0 ? null : ix.ways[wi].tags; });
  let gap = 0;   // rellena huecos de hasta 120 m
  for (let i = 0; i < n; i++) { if (!tags[i] && i && tags[i - 1] && gap < 3) { tags[i] = tags[i - 1]; gap++; } else if (tags[i]) gap = 0; }
  const surf = tags.map((t) => (t ? surfClass(t) : 'unk')), traf = tags.map((t) => (t ? trafClass(t) : 'unk'));
  const share = (arr) => { const o = {}; arr.forEach((c) => { o[c] = (o[c] || 0) + 0.04; }); return o; };
  const S = share(surf), T = share(traf), tot = n * 0.04 || 1;
  r.q = { pts, surf, traf, nm: tags.map((t) => (t && (t.name || t.ref)) || ''), sf: tags.map((t) => (t && t.surface) || ''), sh: { surf: S, traf: T } };
  r.calm = -(((S.bad || 0) * 3 + (S.fair || 0) + (T.high || 0) * 3 + (T.med || 0)) / tot);
}

function runs(r, key, cls) {
  const arr = r.q[key], out = [];
  let s = -1;
  for (let i = 0; i <= arr.length; i++) {
    const hit = i < arr.length && arr[i] === cls;
    if (hit && s < 0) s = i;
    if (!hit && s >= 0) { const km = (i - s) * 0.04; if (km >= 0.1) out.push({ i0: s, km, name: r.q.nm[s], tag: r.q.sf[s] }); s = -1; }
  }
  return out.sort((a, b) => b.km - a.km).slice(0, 3);
}

function overlay() {
  rideGroup.clearLayers(); warnGroup.clearLayers();
  const r = currentData && currentData[currentMode];
  if (!r || !r.q || layer === 'off') return;
  const arr = r.q[layer], pts = r.q.pts;
  let s = 0;
  for (let i = 1; i <= arr.length; i++) {
    if (i === arr.length || arr[i] !== arr[s]) { L.polyline(pts.slice(s, Math.min(pts.length, i + 1)), { color: COL[layer][arr[s]], weight: 6, lineCap: 'butt', interactive: false }).addTo(rideGroup); s = i; }
  }
  if (layer === 'surf') runs(r, 'surf', 'bad').forEach((w) => L.marker(pts[w.i0], { icon: L.divIcon({ className: '', html: '<div class="warn-pin">⚠️</div>', iconSize: [26, 26] }), interactive: false }).addTo(warnGroup));
}

async function doElev(r) {
  const c = r.coords, n = Math.min(80, Math.max(12, Math.round((r.distance / 1000) * 4)));
  const idx = Array.from({ length: n }, (_, i) => Math.round((i * (c.length - 1)) / (n - 1)));
  const d = await getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${idx.map((i) => c[i][0].toFixed(4)).join(',')}&longitude=${idx.map((i) => c[i][1].toFixed(4)).join(',')}`, {}, 10000);
  const h = d.elevation, dist = [0];
  for (let k = 1; k < n; k++) dist[k] = dist[k - 1] + haversine(c[idx[k - 1]], c[idx[k]]);
  const sm = h.map((_, i) => (h[Math.max(0, i - 1)] + h[i] + h[Math.min(n - 1, i + 1)]) / 3);
  let up = 0, down = 0, maxg = 0;
  for (let k = 1; k < n; k++) {
    const dh = sm[k] - sm[k - 1], dd = (dist[k] - dist[k - 1]) * 1000;
    if (dh > 0) up += dh; else down -= dh;
    if (dd > 20) maxg = Math.max(maxg, (Math.abs(dh) / dd) * 100);
  }
  r.elev = { h: sm, dist, up, down, maxg, min: Math.min(...sm), max: Math.max(...sm) };
}
const loadElev = (r) => (r.elevP ||= doElev(r).catch(() => { r.elev = false; }));

function chart(e) {
  const W = 300, H = 70, span = Math.max(e.max - e.min, 10), tot = e.dist[e.dist.length - 1] || 1;
  const pts = e.h.map((v, i) => `${((e.dist[i] / tot) * W).toFixed(1)},${(H - 4 - ((v - e.min) / span) * (H - 12)).toFixed(1)}`);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="elev"><defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a1a" stop-opacity=".55"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></linearGradient></defs>
    <polygon points="0,${H} ${pts.join(' ')} ${W},${H}" fill="url(#eg)"/><polyline points="${pts.join(' ')}" fill="none" stroke="#ff7a1a" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

function renderInfo() {
  const el = $('ride-info'), r = currentData && currentData[currentMode];
  if (!el || !r) return;
  const key = layer === 'off' ? 'surf' : layer;
  let h = '', warns = [];
  if (r.q) {
    const chip = (k, l) => `<button class="rchip ${layer === k ? 'on' : ''}" data-l="${k}">${l}</button>`;
    const sh = r.q.sh[key], tot = Object.values(sh).reduce((a, b) => a + b, 0) || 1, cl = Object.keys(COL[key]).filter((c) => sh[c]);
    h += `<div class="rchips">${chip('surf', '🛣️ Firme')}${chip('traf', '🚦 Tráfico')}${chip('off', 'Ocultar')}</div>
      <div class="sbar">${cl.map((c) => `<i style="width:${(sh[c] / tot) * 100}%;background:${COL[key][c]}"></i>`).join('')}</div>
      <div class="slegend">${cl.map((c) => `<span><i style="background:${COL[key][c]}"></i>${NAMES[key][c]} ${Math.round((sh[c] / tot) * 100)}%</span>`).join('')}</div>`;
    warns = [
      ...runs(r, 'surf', 'bad').map((x) => ({ ic: '⚠️', t: `${x.km.toFixed(1)} km de firme malo${x.tag ? ' (' + x.tag + ')' : ''}${x.name ? ' · ' + x.name : ''}`, ll: r.q.pts[x.i0] })),
      ...runs(r, 'traf', 'high').map((x) => ({ ic: '🚗', t: `${x.km.toFixed(1)} km con tráfico alto${x.name ? ' · ' + x.name : ''}`, ll: r.q.pts[x.i0] }))
    ];
    h += warns.map((x, i) => `<button class="rwarn" data-w="${i}">${x.ic} ${escapeHtml(x.t)}</button>`).join('');
    const unk = (r.q.sh.surf.unk || 0) / ((r.q.pts.length * 0.04) || 1);
    h += !warns.length ? `<div class="rgood">✅ Sin tramos problemáticos detectados</div>` : '';
    if (unk > 0.4) h += `<div class="rnote">ℹ️ Poca información de OpenStreetMap en parte de esta zona.</div>`;
  } else if (r.analyzing) h += `<div class="rnote"><span class="spin"></span>Analizando firme y tráfico…</div>`;
  else if (r.qerr) h += `<div class="rnote">⚠️ No se pudo analizar el firme (servidor ocupado o ruta muy larga).</div>`;
  if (r.elev) h += `<div class="elev-box">${chart(r.elev)}<div class="elev-stats"><span>⬆️ ${Math.round(r.elev.up)} m</span><span>⬇️ ${Math.round(r.elev.down)} m</span><span>📈 máx ~${Math.round(r.elev.maxg)}%</span></div></div>`;
  else if (r.elev === undefined || r.elevP) h += r.elev === false ? '' : `<div class="rnote"><span class="spin"></span>Calculando desnivel…</div>`;
  const d = new Date(), hr = d.getHours(), wd = d.getDay();
  if (wd >= 1 && wd <= 5 && ((hr >= 7 && hr < 10) || (hr >= 17 && hr < 20))) h += `<div class="rnote">⏰ Hora punta: habrá más tráfico del habitual en vías principales.</div>`;
  h += `<div class="rnote">Datos de OpenStreetMap: el firme y el tráfico se estiman por tipo de vía y etiquetas del mapa, no es tráfico en tiempo real.</div>`;
  el.innerHTML = h;
  el.querySelectorAll('.rchip').forEach((b) => b.addEventListener('click', () => { layer = b.dataset.l; overlay(); renderInfo(); }));
  el.querySelectorAll('.rwarn').forEach((b) => b.addEventListener('click', () => { map.flyTo(warns[+b.dataset.w].ll, 17, { duration: 0.8 }); }));
}

async function startAnalysis() {
  const data = currentData;
  if (!data) return;
  const routes = [...new Set([data.fast, data.fun, data.bal, ...data.all])].slice(0, 6);
  routes.forEach((r) => { r.analyzing = true; });
  if (routes.some((r) => r.distance > 80000)) { routes.forEach((r) => { r.analyzing = false; r.qerr = true; }); renderInfo(); return; }
  renderInfo();
  try {
    const ix = buildIndex(await fetchWays(routes));
    if (currentData !== data) return;
    routes.forEach((r) => analyzeOne(r, ix));
    if (PREFS.vehicle === 'bike') {   // en bici, "Tranquila" = mejor firme y menos tráfico (sin pasarse de tiempo)
      const ok = data.all.filter((r) => r.q && r.duration <= data.fast.duration * 1.8);
      data.bal = data.balanced = [...ok].sort((a, b) => b.calm - a.calm)[0] || data.bal;
      showToast('🌿 Ruta tranquila calculada');
    }
  } catch { routes.forEach((r) => { r.qerr = true; }); }
  routes.forEach((r) => { r.analyzing = false; });
  if (currentData === data) renderRoute();
}

const _render = renderRoute;
renderRoute = function () {
  _render(); overlay(); renderInfo();
  const r = currentData && currentData[currentMode];
  if (r) loadElev(r).then(() => { if (currentData && currentData[currentMode] === r) renderInfo(); });
};
const _enter = enterRouteMode;
enterRouteMode = function () { _enter(); startAnalysis(); };
const _exit = exitRouteMode;
exitRouteMode = function () { _exit(); rideGroup.clearLayers(); warnGroup.clearLayers(); $('ride-info').innerHTML = ''; };
window.__ride = { surfClass, trafClass, buildIndex, nearestWay, analyzeOne, runs };
})();
