// ═══════════════════ Estado ═══════════════════
let map = null, routeGroup = null, markerGroup = null;
let userLatLng = null, currentData = null, destinationName = '', destinationCoords = null;
let currentMode = 'fast', searchId = 0;

const $ = (id) => document.getElementById(id);
const landing = $('landing'), results = $('results');
const destInput = $('destination'), destInput2 = $('destination2');
const loadingOverlay = $('loading'), loadingText = $('loading-text'), toast = $('toast');
const RECENT_KEY = 'funride_recent';
// Mapa base sin API key (OpenStreetMap). Para producción, cambia por un proveedor con tu propia key (MapTiler, Stadia...)
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const FUN_FACTS = [
  '💡 Las carreteras sinuosas suelen tener mejores vistas que las autovías.',
  '🧠 Conducir por curvas mejora tu concentración y reflejos.',
  '🏍️ Las "curvas buenas" son de radio amplio, buen asfalto y buena visibilidad.',
  '⛰️ Las mejores rutas de montaña tienen entre 200 y 500 curvas por cada 100 km.',
  '🌅 Sal temprano: las carreteras de montaña están más vacías y el asfalto, limpio.',
  '🔧 Revisa presión de neumáticos antes de una ruta de curvas.'
];

// ═══════════════════ Inicialización ═══════════════════
function init() {
  setGreeting(); updateRecentUI(); rotateFact();
  setInterval(rotateFact, 8000);
  getLocation(); bindEvents();
  attachAutocomplete(destInput); attachAutocomplete(destInput2);
}

function setGreeting() {
  const h = new Date().getHours();
  $('greeting').textContent = h >= 6 && h < 12 ? 'Buenos días ☀️' : h >= 12 && h < 20 ? 'Buenas tardes 👋' : 'Buenas noches 🌙';
}

function rotateFact() {
  const el = $('fun-fact');
  el.style.opacity = '0';
  setTimeout(() => { el.textContent = FUN_FACTS[Math.floor(Math.random() * FUN_FACTS.length)]; el.style.opacity = '1'; }, 250);
}

function getLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (p) => { userLatLng = [p.coords.latitude, p.coords.longitude]; },
    (e) => console.warn('Geolocation:', e.message),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

async function ensureLocation() {
  if (userLatLng) return;
  try {
    userLatLng = await new Promise((res, rej) => {
      if (!navigator.geolocation) return rej();
      navigator.geolocation.getCurrentPosition((p) => res([p.coords.latitude, p.coords.longitude]), rej, { enableHighAccuracy: true, timeout: 12000 });
    });
  } catch {
    userLatLng = [40.4168, -3.7038];
    showToast('⚠️ Sin GPS · usando Madrid como origen');
  }
}

// ═══════════════════ Red ═══════════════════
async function getJSON(url, opts = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(url, { ...opts, signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const geocode = (q, limit = 1) =>
  getJSON(`https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'es' } });

async function osrm(points, alternatives = false) {
  const path = points.map((p) => `${p[1]},${p[0]}`).join(';');
  const d = await getJSON(`https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson&alternatives=${alternatives ? 3 : 'false'}`);
  return d.routes || [];
}

// ═══════════════════ Búsqueda ═══════════════════
async function searchDestination(query, preset) {
  query = (query || '').trim();
  if (!query && !preset) return;
  const id = ++searchId;
  closeAllAc();
  showLoading('Buscando dirección...');
  try {
    await ensureLocation();
    if (preset) {
      destinationCoords = [preset.lat, preset.lon];
      destinationName = preset.name;
    } else {
      const g = await geocode(query);
      if (!g.length) throw new Error('No encontramos esa dirección 😕');
      destinationCoords = [parseFloat(g[0].lat), parseFloat(g[0].lon)];
      destinationName = g[0].display_name.split(',')[0];
    }

    loadingText.textContent = 'Explorando rutas y curvas...';
    const routes = await buildCandidates(userLatLng, destinationCoords);
    if (id !== searchId) return;
    if (!routes.length) throw new Error('No hay rutas disponibles 🛣️');

    const fastest = [...routes].sort((a, b) => a.duration - b.duration)[0];
    // Divertida: más curvas por km, sin pasarse del 70% extra de tiempo
    const ok = routes.filter((r) => r.duration <= fastest.duration * 1.7);
    const funnest = [...ok].sort((a, b) => b.score - a.score)[0] || fastest;
    currentData = { fastest, funnest, all: routes };
    currentData.fast = fastest; currentData.fun = funnest;

    saveRecent({ name: destinationName, lat: destinationCoords[0], lon: destinationCoords[1] });
    hideLoading();
    showResults();
    if (fastest === funnest) showToast('🎉 La ruta rápida ya es la más divertida');
  } catch (err) {
    hideLoading();
    const msg = err.name === 'AbortError' ? 'El servidor tarda demasiado. Inténtalo de nuevo' : err.message === 'Failed to fetch' ? 'Sin conexión' : err.message;
    showToast('⚠️ ' + (msg || 'Error al buscar'));
  }
}

// Rutas base + desvíos por puntos intermedios laterales (para forzar caminos más curvos)
async function buildCandidates(a, b) {
  const D = haversine(a, b);
  const jobs = [osrm([a, b], true)];
  if (D > 4) {
    const brg = bearing(a, b);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const f of [0.12, 0.25, 0.4]) {
      for (const side of [90, -90]) {
        jobs.push(osrm([a, offsetPoint(mid, brg + side, D * f), b]));
      }
    }
  }
  const settled = await Promise.allSettled(jobs);
  const raw = settled.filter((s) => s.status === 'fulfilled').flatMap((s) => s.value);
  if (!raw.length && settled[0].status === 'rejected') throw settled[0].reason;

  const seen = new Set();
  return raw
    .filter((r) => { const k = Math.round(r.distance / 150) + '-' + Math.round(r.duration / 20); return seen.has(k) ? false : seen.add(k); })
    .filter((r) => r.distance < raw[0].distance * 2)
    .map((r) => {
      const coords = r.geometry.coordinates.map((c) => [c[1], c[0]]);
      return { coords, distance: r.distance, duration: r.duration, ...analyzeCurves(coords, r.distance / 1000) };
    });
}

// ═══════════════════ Render ═══════════════════
function showResults() {
  landing.classList.add('hidden');
  results.classList.remove('hidden');
  destInput2.value = destinationName;
  syncModeUI();
  if (!map) {
    map = L.map('map', { zoomControl: false }).setView(userLatLng, 13);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    routeGroup = L.layerGroup().addTo(map);
    markerGroup = L.layerGroup().addTo(map);
    $('map').classList.add('visible');
  }
  setTimeout(() => { map.invalidateSize(); renderRoute(); }, 120);
}

function renderRoute() {
  if (!map || !currentData) return;
  routeGroup.clearLayers(); markerGroup.clearLayers();
  const route = currentData[currentMode];
  const other = currentData[currentMode === 'fast' ? 'fun' : 'fast'];
  const color = currentMode === 'fast' ? '#ffb800' : '#ff3d71';
  const glow = currentMode === 'fast' ? 'rgba(255,184,0,0.5)' : 'rgba(255,61,113,0.6)';
  const line = { lineCap: 'round', lineJoin: 'round' };

  if (other !== route) L.polyline(other.coords, { ...line, color: '#94a3b8', weight: 4, opacity: 0.55, dashArray: '2 9' }).addTo(routeGroup);
  L.polyline(route.coords, { ...line, color: glow, weight: 16, opacity: 0.6 }).addTo(routeGroup);
  const main = L.polyline(route.coords, { ...line, color, weight: 6 }).addTo(routeGroup);
  main.bindTooltip(modeLabel(currentMode), { sticky: true });

  const pin = (ll, cls) => L.marker(ll, { icon: L.divIcon({ className: '', html: `<div class="pin ${cls}"></div>`, iconSize: [18, 18] }), interactive: false }).addTo(markerGroup);
  pin(route.coords[0], 'pin-start');
  pin(route.coords[route.coords.length - 1], 'pin-end');

  fitRoute();
  updateStats(route);
  updateCompare();
}

function fitRoute() {
  if (!map || !currentData) return;
  const b = L.latLngBounds(currentData[currentMode].coords);
  map.fitBounds(b, { paddingTopLeft: [40, 90], paddingBottomRight: [40, Math.round(window.innerHeight * 0.42)], maxZoom: 16, animate: true });
}

const modeLabel = (m) => (m === 'fast' ? '⚡ Rápida' : '🏍️ Divertida');
const fmtTime = (s) => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`; };

function funLevel(pct) {
  return pct < 20 ? 'Tranquila' : pct < 45 ? 'Animada' : pct < 70 ? 'Muy curvera' : 'Pura diversión';
}

function updateStats(r) {
  const eta = new Date(Date.now() + r.duration * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  $('route-stats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${(r.distance / 1000).toFixed(1)} km</div><div class="stat-label">Distancia</div></div>
    <div class="stat-card"><div class="stat-value">${fmtTime(r.duration)}</div><div class="stat-label">Llegas ${eta}</div></div>
    <div class="stat-card"><div class="stat-value">${r.turns}</div><div class="stat-label">Curvas</div></div>`;
  const pct = Math.min(100, Math.round((r.turnsPerKm / 3) * 100));
  $('fun-percent').textContent = `${pct}% · ${funLevel(pct)}`;
  const fill = $('fun-meter-fill');
  fill.style.width = '0%';
  setTimeout(() => { fill.style.width = pct + '%'; }, 120);
}

function updateCompare() {
  const { fastest, funnest } = currentData;
  const bar = $('compare-bar');
  if (fastest === funnest) { bar.textContent = '🎯 Es la mejor opción en velocidad y diversión'; return; }
  const dMin = Math.round((funnest.duration - fastest.duration) / 60);
  const dTurns = funnest.turns - fastest.turns;
  const dKm = ((funnest.distance - fastest.distance) / 1000).toFixed(1);
  bar.innerHTML = currentMode === 'fast'
    ? `🏍️ La <b>divertida</b> suma <b>${dTurns >= 0 ? '+' : ''}${dTurns} curvas</b> por <b>+${dMin} min</b> y <b>+${dKm} km</b>`
    : `⚡ La <b>rápida</b> te ahorra <b>${dMin} min</b> pero tiene <b>${Math.abs(dTurns)} curvas ${dTurns >= 0 ? 'menos' : 'más'}</b>`;
}

function syncModeUI() {
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === currentMode));
  document.querySelector('.mode-toggle').dataset.mode = currentMode;
}

// ═══════════════════ Geometría ═══════════════════
// Remuestrea cada ~50 m y acumula giros del mismo sentido: una "curva" = giro acumulado ≥ 25°
function analyzeCurves(coords, km) {
  const pts = resample(coords, 0.05);
  let turns = 0, curveDeg = 0, acc = 0, prevSign = 0;
  const close = () => { if (Math.abs(acc) >= 25) { turns++; curveDeg += Math.abs(acc); } acc = 0; };
  for (let i = 1; i < pts.length - 1; i++) {
    let d = bearing(pts[i], pts[i + 1]) - bearing(pts[i - 1], pts[i]);
    d = ((d + 540) % 360) - 180;
    const s = Math.sign(d);
    if (Math.abs(d) < 2) { close(); prevSign = 0; continue; }
    if (s !== prevSign) close();
    acc += d; prevSign = s;
  }
  close();
  const k = Math.max(km, 0.1);
  return { turns, turnsPerKm: turns / k, score: curveDeg / k + turns / k * 20 };
}

function resample(c, step) {
  const out = [c[0]]; let carry = 0;
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1], b = c[i], d = haversine(a, b);
    if (!d) continue;
    let pos = step - carry;
    while (pos <= d) { const t = pos / d; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); pos += step; }
    carry = d - (pos - step);
  }
  return out;
}

function offsetPoint(p, brg, km) {
  const r = Math.PI / 180, dl = km / 6371, t = brg * r, f1 = p[0] * r, l1 = p[1] * r;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(dl) + Math.cos(f1) * Math.sin(dl) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(dl) * Math.cos(f1), Math.cos(dl) - Math.sin(f1) * Math.sin(f2));
  return [f2 / r, l2 / r];
}

function bearing(p1, p2) {
  const r = Math.PI / 180, f1 = p1[0] * r, f2 = p2[0] * r, dl = (p2[1] - p1[1]) * r;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

function haversine(p1, p2) {
  const r = Math.PI / 180, dLat = (p2[0] - p1[0]) * r, dLon = (p2[1] - p1[1]) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1[0] * r) * Math.cos(p2[0] * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ═══════════════════ Autocompletado ═══════════════════
function attachAutocomplete(input) {
  const host = input.closest('.search-hero, .mini-search');
  const box = document.createElement('div');
  box.className = 'ac-box hidden';
  host.appendChild(box);
  let timer, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) return box.classList.add('hidden');
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const res = await geocode(q, 5);
        if (my !== seq || !res.length) return box.classList.add('hidden');
        box.innerHTML = res.map((r, i) => {
          const parts = r.display_name.split(',');
          return `<div class="ac-item" data-i="${i}"><b>${escapeHtml(parts[0])}</b><span>${escapeHtml(parts.slice(1, 3).join(',').trim())}</span></div>`;
        }).join('');
        box.classList.remove('hidden');
        box.querySelectorAll('.ac-item').forEach((el) => el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const r = res[+el.dataset.i];
          input.value = r.display_name.split(',')[0];
          searchDestination('', { name: input.value, lat: parseFloat(r.lat), lon: parseFloat(r.lon) });
        }));
      } catch { box.classList.add('hidden'); }
    }, 400);
  });
  input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
}
const closeAllAc = () => document.querySelectorAll('.ac-box').forEach((b) => b.classList.add('hidden'));

// ═══════════════════ Historial ═══════════════════
function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').map((r) => (typeof r === 'string' ? { name: r } : r));
  } catch { return []; }
}

function saveRecent(item) {
  const recent = [item, ...loadRecent().filter((r) => r.name !== item.name)].slice(0, 5);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch {}
  updateRecentUI();
}

function updateRecentUI() {
  const recent = loadRecent();
  const section = $('recent-section'), list = $('recent-list');
  if (!recent.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = recent.map((r, i) => `<div class="recent-item" data-i="${i}" tabindex="0" role="button"><span>🕐</span><span>${escapeHtml(r.name)}</span></div>`).join('');
  list.querySelectorAll('.recent-item').forEach((el) => {
    const go = () => { const r = recent[+el.dataset.i]; searchDestination(r.name, r.lat ? r : undefined); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ═══════════════════ UI helpers ═══════════════════
function showLoading(t) { if (t) loadingText.textContent = t; loadingOverlay.classList.remove('hidden'); }
function hideLoading() { loadingOverlay.classList.add('hidden'); }
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ═══════════════════ Eventos ═══════════════════
function bindEvents() {
  $('search-btn').addEventListener('click', () => searchDestination(destInput.value));
  destInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchDestination(destInput.value); });
  destInput2.addEventListener('keydown', (e) => { if (e.key === 'Enter') { searchDestination(destInput2.value); destInput2.blur(); } });
  destInput2.addEventListener('focus', () => destInput2.select());

  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => searchDestination(c.dataset.dest)));

  document.querySelectorAll('.mode-btn').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.mode === currentMode || !currentData) return;
    currentMode = btn.dataset.mode;
    syncModeUI(); renderRoute();
  }));

  $('back-btn').addEventListener('click', () => {
    results.classList.add('hidden'); landing.classList.remove('hidden'); destInput.value = '';
  });
  $('recenter-btn').addEventListener('click', fitRoute);

  $('share-btn').addEventListener('click', async () => {
    if (!currentData) return;
    const r = currentData[currentMode];
    const text = `${modeLabel(currentMode)} FunRide · ${destinationName}\n${(r.distance / 1000).toFixed(1)} km · ${fmtTime(r.duration)} · ${r.turns} curvas\n${mapsUrl(r)}`;
    try {
      if (navigator.share) await navigator.share({ title: 'FunRide 🏍️', text });
      else { await navigator.clipboard.writeText(text); showToast('✅ Copiado al portapapeles'); }
    } catch (e) { if (e.name !== 'AbortError') showToast('⚠️ No se pudo compartir'); }
  });

  $('go-btn').addEventListener('click', () => {
    if (currentData) window.open(mapsUrl(currentData[currentMode]), '_blank', 'noopener');
  });
}

// Google Maps con puntos intermedios para que siga la ruta elegida (máx. 8)
function mapsUrl(r) {
  const n = 8, c = r.coords, wp = [];
  for (let i = 1; i <= n; i++) { const p = c[Math.floor((c.length - 1) * i / (n + 1))]; wp.push(p[0].toFixed(5) + ',' + p[1].toFixed(5)); }
  const f = (p) => p[0].toFixed(5) + ',' + p[1].toFixed(5);
  return `https://www.google.com/maps/dir/?api=1&origin=${f(c[0])}&destination=${f(c[c.length - 1])}&travelmode=driving` +
    (currentMode === 'fun' ? `&waypoints=${encodeURIComponent(wp.join('|'))}` : '');
}

init();
