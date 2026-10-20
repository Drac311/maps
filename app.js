// ═══════════════════ Estado ═══════════════════
let map = null;
let userLatLng = null;
let routeLayers = { fast: null, fun: null };
let currentData = null;
let currentMode = 'fast';
let destinationName = '';
let destinationCoords = null;

const $ = (id) => document.getElementById(id);
const landing = $('landing');
const results = $('results');
const destInput = $('destination');
const destInput2 = $('destination2');
const loadingOverlay = $('loading');
const loadingText = $('loading-text');
const toast = $('toast');

const FUN_FACTS = [
  '💡 Las carreteras sinuosas suelen tener mejores vistas que las autovías.',
  '🧠 Conducir por curvas mejora tu concentración y reflejos.',
  '🏍️ Los motoristas consideran "curvas buenas" las de radio amplio y buen asfalto.',
  '🌍 El turismo de curvas mueve millones de personas al año en Europa.',
  '⛰️ Las mejores rutas de montaña tienen entre 200 y 500 curvas por cada 100 km.',
  '🚗 Un coche deportivo aprovecha mejor las curvas cerradas que las rectas largas.'
];

// ═══════════════════ Inicialización ═══════════════════
function init() {
  setGreeting();
  updateRecentUI();
  rotateFact();
  setInterval(rotateFact, 8000);
  getLocation();
  bindEvents();
}

function setGreeting() {
  const h = new Date().getHours();
  let g = 'Buenas noches 🌙';
  if (h >= 6 && h < 12) g = 'Buenos días ☀️';
  else if (h >= 12 && h < 20) g = 'Buenas tardes 👋';
  $('greeting').textContent = g;
}

function rotateFact() {
  const el = $('fun-fact');
  el.style.opacity = '0';
  setTimeout(() => {
    el.textContent = FUN_FACTS[Math.floor(Math.random() * FUN_FACTS.length)];
    el.style.opacity = '1';
  }, 250);
}

function getLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => { userLatLng = [pos.coords.latitude, pos.coords.longitude]; },
    (err) => console.warn('Geolocation:', err.message),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

async function ensureLocation() {
  if (userLatLng) return;
  try {
    userLatLng = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
        reject,
        { enableHighAccuracy: true, timeout: 12000 }
      );
    });
  } catch {
    userLatLng = [40.4168, -3.7038];
    showToast('⚠️ Sin GPS · usando Madrid como origen');
  }
}

// ═══════════════════ Búsqueda ═══════════════════
async function searchDestination(query) {
  query = (query || '').trim();
  if (!query) return;

  showLoading('Buscando dirección...');
  try {
    await ensureLocation();

    // 1) Geocodificar destino
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      { headers: { 'Accept-Language': 'es' } }
    );
    const geoData = await geoRes.json();
    if (!geoData.length) throw new Error('No encontramos esa dirección 😕');

    destinationCoords = [parseFloat(geoData[0].lat), parseFloat(geoData[0].lon)];
    destinationName = geoData[0].display_name.split(',')[0];

    // 2) Obtener rutas alternativas
    loadingText.textContent = 'Calculando rutas alternativas...';
    const osrmUrl =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${userLatLng[1]},${userLatLng[0]};${destinationCoords[1]},${destinationCoords[0]}` +
      `?overview=full&geometries=geojson&alternatives=3`;
    const routeRes = await fetch(osrmUrl);
    const routeData = await routeRes.json();
    if (!routeData.routes?.length) throw new Error('No hay rutas disponibles 🛣️');

    // 3) Procesar y clasificar
    const processed = routeData.routes.map((r) => {
      const coords = r.geometry.coordinates.map((c) => [c[1], c[0]]);
      return {
        coords,
        distance: r.distance,
        duration: r.duration,
        score: calculateCurvatureScore(coords),
        turns: countTurns(coords)
      };
    });

    const fastest = [...processed].sort((a, b) => a.duration - b.duration)[0];
    const funnest = [...processed].sort((a, b) => b.score - a.score)[0];
    currentData = { fastest, funnest, all: processed };

    saveRecent(destinationName);
    hideLoading();
    showResults();

  } catch (err) {
    hideLoading();
    showToast('⚠️ ' + (err.message || 'Error al buscar'));
  }
}

// ═══════════════════ Render de resultados ═══════════════════
function showResults() {
  landing.classList.add('hidden');
  results.classList.remove('hidden');

  // Init mapa (solo la primera vez)
  if (!map) {
    setTimeout(() => {
      map = L.map('map', { zoomControl: false }).setView(userLatLng, 13);
      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        { maxZoom: 20 }
      ).addTo(map);
      document.getElementById('map').classList.add('visible');
      renderRoute();
      setTimeout(() => map.invalidateSize(), 400);
    }, 100);
  } else {
    renderRoute();
  }

  destInput2.value = destinationName;
}

function renderRoute() {
  if (!map || !currentData) return;
  const route = currentData[currentMode];

  // Limpiar capas anteriores
  Object.values(routeLayers).forEach((l) => { if (l) map.removeLayer(l); });

  // Estilo según modo
  const color = currentMode === 'fast' ? '#ffb800' : '#ff3d71';
  const glow  = currentMode === 'fast' ? 'rgba(255,184,0,0.5)' : 'rgba(255,61,113,0.6)';

  // Capa "glow" de fondo
  L.polyline(route.coords, {
    color: glow, weight: 16, opacity: 0.6, lineCap: 'round', lineJoin: 'round'
  }).addTo(map);

  // Línea principal
  routeLayers[currentMode] = L.polyline(route.coords, {
    color, weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round'
  }).addTo(map);

  // 🎯 ZOOM AUTOMÁTICO a la ruta
  map.fitBounds(routeLayers[currentMode].getBounds(), {
    padding: [80, 80],
    maxZoom: 16,
    animate: true,
    duration: 1.2
  });

  updateStats(route);
  updateCompare();
}

function updateStats(route) {
  const mins = Math.round(route.duration / 60);
  const timeStr = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  const km = (route.distance / 1000).toFixed(1);

  $('route-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${km} km</div>
      <div class="stat-label">Distancia</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${timeStr}</div>
      <div class="stat-label">Tiempo</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${route.turns}</div>
      <div class="stat-label">Curvas</div>
    </div>
  `;

  // Medidor (score 0-500 → 0-100%)
  const pct = Math.min(100, Math.round((route.score / 500) * 100));
  $('fun-percent').textContent = pct + '%';
  const fill = $('fun-meter-fill');
  fill.style.width = '0%';
  setTimeout(() => { fill.style.width = pct + '%'; }, 120);
}

function updateCompare() {
  const { fastest, funnest } = currentData;
  const bar = $('compare-bar');

  if (currentMode === 'fast') {
    const diffMin = Math.round((funnest.duration - fastest.duration) / 60);
    const diffTurns = funnest.turns - fastest.turns;
    bar.innerHTML = `🏍️ La <b>divertida</b> tiene <b>+${diffTurns} curvas</b> pero <b>+${diffMin} min</b>`;
  } else {
    const diffMin = Math.round((funnest.duration - fastest.duration) / 60);
    const diffTurns = funnest.turns - fastest.turns;
    bar.innerHTML = `⚡ La <b>rápida</b> te ahorra <b>${diffMin} min</b> pero pierde <b>${diffTurns} curvas</b>`;
  }
}

// ═══════════════════ Cálculos geográficos ═══════════════════
function calculateCurvatureScore(coords) {
  if (coords.length < 3) return 0;
  let total = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const b1 = bearing(coords[i - 1], coords[i]);
    const b2 = bearing(coords[i], coords[i + 1]);
    let d = Math.abs(b1 - b2);
    if (d > 180) d = 360 - d;
    total += d;
  }
  let km = 0;
  for (let i = 1; i < coords.length; i++) km += haversine(coords[i - 1], coords[i]);
  return km > 0 ? total / km : total;
}

function countTurns(coords) {
  let turns = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const b1 = bearing(coords[i - 1], coords[i]);
    const b2 = bearing(coords[i], coords[i + 1]);
    let d = Math.abs(b1 - b2);
    if (d > 180) d = 360 - d;
    if (d > 25) turns++;
  }
  return turns;
}

function bearing(p1, p2) {
  const [lat1, lon1] = p1.map((x) => (x * Math.PI) / 180);
  const [lat2, lon2] = p2.map((x) => (x * Math.PI) / 180);
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function haversine(p1, p2) {
  const R = 6371;
  const dLat = ((p2[0] - p1[0]) * Math.PI) / 180;
  const dLon = ((p2[1] - p1[1]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1[0] * Math.PI) / 180) *
    Math.cos((p2[0] * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ═══════════════════ Historial ═══════════════════
function saveRecent(name) {
  let recent = JSON.parse(localStorage.getItem('funride_recent') || '[]');
  recent = [name, ...recent.filter((r) => r !== name)].slice(0, 5);
  localStorage.setItem('funride_recent', JSON.stringify(recent));
  updateRecentUI();
}

function updateRecentUI() {
  const recent = JSON.parse(localStorage.getItem('funride_recent') || '[]');
  const section = $('recent-section');
  const list = $('recent-list');
  if (!recent.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = recent
    .map((r) => `
      <div class="recent-item" data-dest="${escapeHtml(r)}">
        <span>🕐</span><span>${escapeHtml(r)}</span>
      </div>`)
    .join('');
  list.querySelectorAll('.recent-item').forEach((item) => {
    item.addEventListener('click', () => searchDestination(item.dataset.dest));
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ═══════════════════ UI helpers ═══════════════════
function showLoading(text) {
  if (text) loadingText.textContent = text;
  loadingOverlay.classList.remove('hidden');
}
function hideLoading() {
  loadingOverlay.classList.add('hidden');
}
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

// ═══════════════════ Eventos ═══════════════════
function bindEvents() {
  // Buscador principal
  $('search-btn').addEventListener('click', () => searchDestination(destInput.value));
  destInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchDestination(destInput.value);
  });

  // Buscador secundario
  destInput2.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchDestination(destInput2.value);
  });

  // Chips de sugerencias
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => searchDestination(chip.dataset.dest));
  });

  // Toggle de modo
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === currentMode || !currentData) return;
      currentMode = mode;
      document.querySelectorAll('.mode-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
      document.querySelector('.mode-toggle').dataset.mode = mode;
      renderRoute();
    });
  });

  // Volver
  $('back-btn').addEventListener('click', () => {
    results.classList.add('hidden');
    landing.classList.remove('hidden');
    destInput2.value = '';
  });

  // Recentrar mapa
  $('recenter-btn').addEventListener('click', () => {
    if (routeLayers[currentMode] && map) {
      map.fitBounds(routeLayers[currentMode].getBounds(), {
        padding: [80, 80], maxZoom: 16, animate: true
      });
    }
  });

  // Compartir
  $('share-btn').addEventListener('click', async () => {
    if (!currentData) return;
    const r = currentData[currentMode];
    const label = currentMode === 'fast' ? '⚡ Rápida' : '🏍️ Divertida';
    const text = `${label} FunRide · ${destinationName}\n` +
                 `${(r.distance / 1000).toFixed(1)} km · ${Math.round(r.duration / 60)} min · ${r.turns} curvas`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'FunRide 🏍️', text });
      } else {
        await navigator.clipboard.writeText(text);
        showToast('✅ Copiado al portapapeles');
      }
    } catch {
      showToast('✅ ' + text);
    }
  });

  // Iniciar ruta en Google Maps
  $('go-btn').addEventListener('click', () => {
    if (!currentData || !destinationCoords || !userLatLng) return;
    const start = `${userLatLng[0]},${userLatLng[1]}`;
    const end = `${destinationCoords[0]},${destinationCoords[1]}`;
    window.open(
      `https://www.google.com/maps/dir/?api=1&origin=${start}&destination=${end}&travelmode=driving`,
      '_blank'
    );
  });
}

init();