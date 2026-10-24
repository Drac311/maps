// ═══════════════════ Estado ═══════════════════
let map = null, routeGroup = null, markerGroup = null, userMarker = null, destMarker = null;
let userLatLng = null, currentData = null, destinationName = '', destinationCoords = null, selectedPlace = null;
let watchId = null, accCircle = null, following = true, poiGroup = null, poiTimer = null, poiKey = '', lastGeoErr = 0;
let nav = null, wake = null;
let currentMode = 'fast', searchId = 0, inRoute = false, acItems = [], acSeq = 0, acTimer = null, acQ = '';

const $ = (id) => document.getElementById(id);
const input = $('destination'), acBox = $('ac-box');
const loadingOverlay = $('loading'), loadingText = $('loading-text'), toast = $('toast');
const RECENT_KEY = 'funride_recent';
// Mapa base sin API key (OpenStreetMap). Para producción, cambia por un proveedor con tu propia key (MapTiler, Stadia...)
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const NOM = 'https://nominatim.openstreetmap.org';
const LANG = { headers: { 'Accept-Language': 'es' } };

// Preferencias personales (guardadas en este dispositivo)
const PREFS = Object.assign({ theme: 'light', poi: true, voice: true, accent: 0, vehicle: 'bike' }, (() => { try { return JSON.parse(localStorage.getItem('funride_prefs') || '{}'); } catch { return {}; } })());
const ACCENTS = [['Fuego', '#ff7a1a', '#ff3d71'], ['Océano', '#06b6d4', '#3b82f6'], ['Bosque', '#10b981', '#06b6d4'], ['Violeta', '#a855f7', '#ec4899'], ['Oro', '#ffb800', '#ff7a1a']];
const savePrefs = () => { try { localStorage.setItem('funride_prefs', JSON.stringify(PREFS)); } catch {} };
function applyPrefs() {
  const ac = ACCENTS[PREFS.accent] || ACCENTS[0], st = document.documentElement.style;
  st.setProperty('--orange', ac[1]); st.setProperty('--orange-2', ac[2]);
  const bb = document.querySelector('.mode-btn[data-mode="bal"]');
  if (bb) bb.innerHTML = PREFS.vehicle === 'bike' ? '<span>🌿</span> Tranquila' : '<span>⚖️</span> Mixta';
  $('map').classList.toggle('map-dark', PREFS.theme === 'dark' || (PREFS.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches));
  if (!poiGroup) return;
  if (!PREFS.poi) poiGroup.clearLayers(); else { poiKey = ''; schedulePois(); }
}

// ═══════════════════ Inicialización ═══════════════════
function init() {
  map = L.map('map', { zoomControl: false }).setView([40.4168, -3.7038], 6);
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
  }
  routeGroup = L.layerGroup().addTo(map);
  markerGroup = L.layerGroup().addTo(map);
  poiGroup = L.layerGroup().addTo(map);
  applyPrefs();
  map.on('click', (e) => { if (!inRoute) pickOnMap(e.latlng.lat, e.latlng.lng); });
  map.on('dragstart', () => { following = false; $('locate-btn').classList.remove('active'); });
  map.on('moveend', schedulePois);
  bindEvents();
  startWatch();
  renderQuick();
  openSharedLink();
}

const pinIcon = (cls) => L.divIcon({ className: '', html: `<div class="pin ${cls}"></div>`, iconSize: [18, 18] });

// GPS continuo: marcador + círculo de precisión, auto-zoom en la primera posición
function startWatch() {
  if (!navigator.geolocation) return showToast('⚠️ Este navegador no soporta GPS');
  if (!window.isSecureContext) showToast('⚠️ El GPS solo funciona con HTTPS o localhost (no con file://)');
  let first = true;
  watchId = navigator.geolocation.watchPosition((p) => {
    userLatLng = [p.coords.latitude, p.coords.longitude];
    if (nav) navTick(p);
    if (!userMarker) {
      userMarker = L.marker(userLatLng, { icon: (window.myMapIcon && window.myMapIcon()) || pinIcon('pin-me'), interactive: false, zIndexOffset: 1000 }).addTo(map);
      accCircle = L.circle(userLatLng, { radius: p.coords.accuracy, color: '#3b82f6', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map);
    } else { userMarker.setLatLng(userLatLng); accCircle.setLatLng(userLatLng).setRadius(p.coords.accuracy); }
    $('locate-btn').classList.add('located');
    if (inRoute || selectedPlace) return;
    if (first) { first = false; loadWeather(); const rough = p.coords.accuracy > 1500; map.flyTo(userLatLng, rough ? 13 : 16, { duration: 1.2 }); $('locate-btn').classList.add('active'); if (rough) showToast('📡 Ubicación aproximada (sin GPS preciso)'); }
    else if (following && haversine([map.getCenter().lat, map.getCenter().lng], userLatLng) > 0.015) map.panTo(userLatLng);
  }, (err) => {
    if (Date.now() - lastGeoErr < 15000) return;
    lastGeoErr = Date.now();
    showToast('⚠️ ' + ({ 1: 'Permiso de ubicación denegado. Actívalo en el navegador', 2: 'No se pudo obtener tu posición', 3: 'La ubicación tarda demasiado' }[err.code] || 'Error de GPS'));
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

function locate() {
  if (!userLatLng) return showToast('📡 Buscando tu posición...');
  following = true;
  $('locate-btn').classList.add('active');
  map.flyTo(userLatLng, Math.max(map.getZoom(), 16), { duration: 0.8 });
}

async function ensureLocation() {
  for (let i = 0; i < 12 && !userLatLng; i++) await new Promise((r) => setTimeout(r, 500));
  if (!userLatLng) { userLatLng = [40.4168, -3.7038]; showToast('⚠️ Sin GPS · usando Madrid como origen'); }
}

const refPoint = () => userLatLng || [map.getCenter().lat, map.getCenter().lng];
const fmtDist = (km) => (km < 1 ? Math.round(km * 1000) + ' m' : km < 10 ? km.toFixed(1).replace('.', ',') + ' km' : Math.round(km) + ' km');

// Locales cercanos (OpenStreetMap/Overpass) al hacer zoom
const POI_ICONS = { restaurant: '🍽️', fast_food: '🍔', cafe: '☕', bar: '🍺', pub: '🍺', fuel: '⛽', drinking_water: '💧', bicycle_repair_station: '🔧' };
const POI_NAMES = { '💧': 'Fuente de agua', '🔧': 'Punto de reparación', '🚲': 'Tienda de bicicletas' };
function schedulePois() { clearTimeout(poiTimer); poiTimer = setTimeout(loadPois, 700); }
async function loadPois() {
  if (inRoute || !PREFS.poi) return;
  if (map.getZoom() < 15) { poiGroup.clearLayers(); poiKey = ''; return; }
  const b = map.getBounds(), box = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()];
  const key = box.map((x) => x.toFixed(3)).join();
  if (key === poiKey) return;
  poiKey = key;
  const bb = box.join(','), bike = PREFS.vehicle === 'bike';
  const q = `[out:json][timeout:10];(node["amenity"~"^(restaurant|cafe|bar|fast_food|fuel|pub)$"]["name"](${bb});${bike ? `node["amenity"~"^(drinking_water|bicycle_repair_station)$"](${bb});node["shop"="bicycle"](${bb});` : ''});out 120;`;
  try {
    const d = await getJSON('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
    poiGroup.clearLayers();
    d.elements.forEach((e) => {
      const icon = POI_ICONS[e.tags.amenity] || (e.tags.shop === 'bicycle' ? '🚲' : '📍');
      L.marker([e.lat, e.lon], { icon: L.divIcon({ className: '', html: `<div class="poi">${icon}</div>`, iconSize: [34, 34] }) })
        .addTo(poiGroup)
        .on('click', () => { if (!inRoute) choosePlace({ name: e.tags.name || POI_NAMES[icon] || 'Lugar', addr: [e.tags['addr:street'], e.tags['addr:housenumber']].filter(Boolean).join(' ') || e.tags.cuisine || '', lat: e.lat, lon: e.lon, icon }); });
    });
  } catch { poiKey = ''; }
}

// ═══════════════════ Red ═══════════════════

function friendly(e) {
  const m = (e && e.message) || '';
  if (e && e.name === 'AbortError') return 'El servidor tarda demasiado. Inténtalo de nuevo';
  if (/429/.test(m)) return 'Demasiadas peticiones. Espera unos segundos';
  if (m === 'Failed to fetch' || /NetworkError/.test(m)) return 'Sin conexión';
  if (/^HTTP 5/.test(m)) return 'El servicio no responde ahora mismo';
  return m || 'Error inesperado';
}

async function getJSON(url, opts = {}, ms = 15000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: c.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const geocode = (q, limit = 1) =>
  getJSON(`https://nominatim.openstreetmap.org/search?format=json&limit=${limit}&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'es' } });

const OSRM_CAR = 'https://router.project-osrm.org/route/v1/driving/';
const ROUTERS = { bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/', moto: OSRM_CAR, car: OSRM_CAR };
async function osrm(points, alternatives = false) {
  const base = ROUTERS[PREFS.vehicle] || OSRM_CAR, path = points.map((p) => `${p[1]},${p[0]}`).join(';');
  const url = (alt) => `${base}${path}?overview=full&geometries=geojson&alternatives=${alt ? 3 : 'false'}&steps=true`;
  let d;
  try { d = await getJSON(url(alternatives)); } catch (e) { if (!alternatives) throw e; d = await getJSON(url(false)); }
  return d.routes || [];
}


// ═══════════════════ Búsqueda ═══════════════════
// ═══ Lugares ═══
function placeIcon(r) {
  const t = r.type, c = r.class;
  if (['restaurant', 'fast_food', 'food_court'].includes(t)) return '🍽️';
  if (['cafe', 'bar', 'pub'].includes(t)) return '☕';
  if (t === 'fuel') return '⛽';
  if (c === 'highway') return '🛣️';
  if (c === 'place' || c === 'boundary') return '🏙️';
  if (c === 'tourism' || c === 'historic') return '🏛️';
  if (c === 'shop') return '🛍️';
  if (c === 'natural') return '⛰️';
  return '📍';
}

function toPlace(r) {
  const parts = r.display_name.split(','), a = r.address || {};
  const name = r.name || [a.road, a.house_number].filter(Boolean).join(' ') || parts[0];
  const lat = +r.lat, lon = +r.lon;
  return { name, addr: parts.slice(1, 4).join(',').trim(), lat, lon, icon: placeIcon(r), dist: haversine(refPoint(), [lat, lon]) };
}

// Pide más resultados, sesgados hacia el usuario, y los ordena por cercanía
async function searchNominatim(q) {
  const [lat, lon] = refPoint(), v = 1.5;
  const url = `${NOM}/search?format=json&limit=15&addressdetails=1&viewbox=${lon - v},${lat + v},${lon + v},${lat - v}&q=${encodeURIComponent(q)}`;
  const res = await getJSON(url, LANG);
  const seen = new Set();
  return res.map(toPlace)
    .filter((p) => { const k = p.name + p.lat.toFixed(3) + p.lon.toFixed(3); return seen.has(k) ? false : seen.add(k); })
    .sort((a, b) => a.dist - b.dist).slice(0, 7);
}

async function searchPlaces(q) {
  const [lat, lon] = refPoint();
  try {
    const d = await getJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${lat}&lon=${lon}&limit=12&location_bias_scale=0.4`, {}, 8000);
    const seen = new Set();
    const list = d.features.map((f) => {
      const p = f.properties, [lo, la] = f.geometry.coordinates;
      const street = [p.street, p.housenumber].filter(Boolean).join(' ');
      return {
        name: p.name || street || p.city || 'Lugar',
        addr: [p.name && street ? street : '', p.city || p.district, p.state].filter(Boolean).join(', '),
        lat: la, lon: lo, icon: placeIcon({ class: p.osm_key, type: p.osm_value }), dist: haversine([lat, lon], [la, lo])
      };
    }).filter((p) => { const k = p.name + p.lat.toFixed(3) + p.lon.toFixed(3); return seen.has(k) ? false : seen.add(k); });
    if (list.length) return list.sort((a, b) => a.dist - b.dist).slice(0, 7);
  } catch {}
  return searchNominatim(q);
}

function selectPlace(p, fly = true) {
  selectedPlace = p;
  if (destMarker) map.removeLayer(destMarker);
  destMarker = L.marker([p.lat, p.lon], { icon: pinIcon('pin-end'), draggable: true }).addTo(map);
  destMarker.on('dragend', () => { const ll = destMarker.getLatLng(); pickOnMap(ll.lat, ll.lng); });
  if (fly) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 16), { duration: 1 });
  $('place-name').textContent = p.name;
  $('place-addr').textContent = p.addr || '';
  $('place-dist').textContent = fmtDist(haversine(refPoint(), [p.lat, p.lon]));
  $('place-card').classList.remove('hidden');
  $('map-hint').classList.add('hidden');
}

function clearPlace() {
  selectedPlace = null;
  if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
  $('place-card').classList.add('hidden');
  $('map-hint').classList.remove('hidden');
  input.value = ''; $('clear-btn').classList.add('hidden');
}

async function pickOnMap(lat, lon) {
  const p = { name: 'Ubicación seleccionada', addr: 'Buscando dirección...', lat, lon };
  selectPlace(p, false);
  try {
    const d = await getJSON(`${NOM}/reverse?format=json&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`, LANG);
    if (selectedPlace !== p) return;
    const a = d.address || {}, parts = (d.display_name || '').split(',');
    p.name = d.name || [a.road, a.house_number].filter(Boolean).join(' ') || parts[0] || p.name;
    p.addr = parts.slice(1, 4).join(',').trim();
    selectPlace(p, false);
  } catch { if (selectedPlace === p) { p.addr = 'Sin dirección disponible'; selectPlace(p, false); } }
}

function choosePlace(p) {
  closeAc();
  input.value = p.name;
  $('clear-btn').classList.remove('hidden');
  if (inRoute) exitRouteMode();
  selectPlace(p);
}

// ═══ Rutas ═══
async function planRoute() {
  const p = selectedPlace;
  if (!p) return;
  const id = ++searchId;
  showLoading('Explorando rutas y curvas...');
  try {
    await ensureLocation();
    destinationCoords = [p.lat, p.lon];
    destinationName = p.name;
    const routes = await buildCandidates(userLatLng, destinationCoords);
    if (id !== searchId) { hideLoading(); return; }
    if (!routes.length) throw new Error('No hay rutas disponibles 🛣️');

    currentData = buildData(routes);

    saveRecent(p);
    hideLoading();
    enterRouteMode();
    if (currentData.fast === currentData.fun) showToast('🎉 La ruta rápida ya es la más divertida');
  } catch (err) {
    hideLoading();
    const msg = friendly(err);
    showToast('⚠️ ' + (msg || 'Error al calcular la ruta'));
  }
}

function enterRouteMode() {
  inRoute = true;
  history.pushState({ r: 1 }, '');
  $('place-card').classList.add('hidden');
  $('route-panel').classList.remove('hidden');
  $('back-btn').classList.remove('hidden');
  $('recenter-btn').classList.remove('hidden');
  $('loop-btn').classList.add('hidden');
  if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
  poiGroup.clearLayers(); poiKey = '';
  syncModeUI();
  renderRoute();
}

function exitRouteMode() {
  if (nav) stopNav();
  inRoute = false; searchId++;
  routeGroup.clearLayers(); markerGroup.clearLayers();
  $('route-panel').classList.add('hidden');
  $('back-btn').classList.add('hidden');
  $('recenter-btn').classList.add('hidden');
  $('loop-btn').classList.remove('hidden');
  $('route-panel').classList.remove('collapsed');
  if (selectedPlace) selectPlace(selectedPlace, false);
  else $('map-hint').classList.remove('hidden');
  schedulePois();
}



// ═══════════════════ Render ═══════════════════

function renderRoute() {
  if (!map || !currentData) return;
  routeGroup.clearLayers(); markerGroup.clearLayers();
  const route = currentData[currentMode];
  const other = currentData[currentMode === 'fast' ? 'fun' : 'fast'];
  const color = { fast: '#ffb800', bal: '#10b981', fun: '#ff3d71' }[currentMode];
  const glow = currentMode === 'fast' ? 'rgba(255,184,0,0.5)' : 'rgba(255,61,113,0.6)';
  const line = { lineCap: 'round', lineJoin: 'round' };

  if (other !== route) L.polyline(other.coords, { ...line, color: '#94a3b8', weight: 4, opacity: 0.55, dashArray: '2 9' }).addTo(routeGroup);
  L.polyline(route.coords, { ...line, color: '#fff', weight: 11, opacity: 0.95 }).addTo(routeGroup);
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
  const desk = innerWidth >= 900;
  map.fitBounds(b, { paddingTopLeft: [desk ? 440 : 40, 90], paddingBottomRight: [40, desk ? 40 : Math.round(innerHeight * 0.42)], maxZoom: 16, animate: true });
}

const modeLabel = (m) => ({ fast: '⚡ Rápida', bal: PREFS.vehicle === 'bike' ? '🌿 Tranquila' : '⚖️ Mixta', fun: '🏍️ Divertida' }[m]);
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
  const { fastest, funnest } = currentData, r = currentData[currentMode], bar = $('compare-bar');
  const pre = r.loop ? `🔄 Circuito de <b>${(r.distance / 1000).toFixed(0)} km</b> · ` : '';
  if (r === fastest) {
    bar.innerHTML = pre + (funnest === fastest ? '🎯 Mejor opción en velocidad y diversión'
      : `🏍️ La <b>divertida</b> suma <b>+${funnest.turns - fastest.turns} curvas</b> por <b>+${Math.round((funnest.duration - fastest.duration) / 60)} min</b>`);
    return;
  }
  const dT = r.turns - fastest.turns, dM = Math.round((r.duration - fastest.duration) / 60);
  bar.innerHTML = `${pre}${modeLabel(currentMode)}: <b>${dT >= 0 ? '+' : ''}${dT} curvas</b> y <b>${dM >= 0 ? '+' : ''}${dM} min</b> frente a la rápida`;
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
function renderAc(items, header) {
  acItems = items;
  if (!items.length) return acBox.classList.add('hidden');
  acBox.innerHTML = (header ? `<div class="ac-head">${header}</div>` : '') + items.map((p, i) => `
    <div class="ac-item" data-i="${i}"><i class="ac-ico">${p.icon || '🕐'}</i>
      <div class="ac-txt"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.addr || '')}</small></div>
      <i class="ac-dist">${fmtDist(haversine(refPoint(), [p.lat, p.lon]))}</i></div>`).join('');
  acBox.classList.remove('hidden');
  acBox.querySelectorAll('.ac-item').forEach((el) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); choosePlace(acItems[+el.dataset.i]); }));
}
const closeAc = () => acBox.classList.add('hidden');

function onType() {
  const q = input.value.trim();
  $('clear-btn').classList.toggle('hidden', !q);
  clearTimeout(acTimer);
  if (!q) return showRecents();
  if (q.length < 2) return closeAc();
  acTimer = setTimeout(async () => {
    const my = ++acSeq;
    try {
      const res = await searchPlaces(q);
      if (my !== acSeq) return;
      if (!res.length) { acBox.innerHTML = '<div class="ac-head">Sin resultados. Prueba con otra palabra o toca el mapa.</div>'; acItems = []; return acBox.classList.remove('hidden'); }
      acQ = q;
      renderAc(res, 'Más cerca de ti primero');
    } catch { closeAc(); }
  }, 300);
}

function showRecents() {
  const r = loadRecent().filter((x) => x.lat).map((x) => ({ ...x, icon: '🕐' }));
  renderAc(r, 'Recientes');
}

async function onEnter() {
  const q = input.value.trim();
  if (!q) return;
  clearTimeout(acTimer);
  if (acQ === q && acItems.length && !acBox.classList.contains('hidden')) return choosePlace(acItems[0]);
  try {
    const res = await searchPlaces(q);
    if (res.length) choosePlace(res[0]); else showToast('😕 No encontramos ese sitio');
  } catch (e) { showToast('⚠️ ' + friendly(e)); }
}

// ═══════════════════ Historial ═══════════════════
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((r) => r && r.lat); } catch { return []; }
}

function saveRecent(p) {
  const item = { name: p.name, addr: p.addr, lat: p.lat, lon: p.lon };
  const recent = [item, ...loadRecent().filter((r) => r.name !== item.name)].slice(0, 6);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch {}
  renderQuick();
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
  input.addEventListener('input', onType);
  input.addEventListener('focus', () => { if (!input.value.trim()) showRecents(); else if (acItems.length) acBox.classList.remove('hidden'); });
  input.addEventListener('blur', () => setTimeout(closeAc, 150));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { onEnter(); input.blur(); } if (e.key === 'Escape') closeAc(); });
  $('clear-btn').addEventListener('click', () => { input.value = ''; $('clear-btn').classList.add('hidden'); input.focus(); });

  $('locate-btn').addEventListener('click', locate);
  $('place-close').addEventListener('click', clearPlace);
  $('route-btn').addEventListener('click', planRoute);

  document.querySelectorAll('.mode-btn').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.mode === currentMode || !currentData) return;
    currentMode = btn.dataset.mode;
    syncModeUI(); renderRoute();
  }));

  $('back-btn').addEventListener('click', () => (history.state && history.state.r ? history.back() : exitRouteMode()));
  window.addEventListener('popstate', () => { if (inRoute) exitRouteMode(); });
  $('recenter-btn').addEventListener('click', fitRoute);
  $('loading-cancel').addEventListener('click', () => { searchId++; hideLoading(); showToast('Cancelado'); });
  $('gpx-btn').addEventListener('click', exportGPX);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) $('mic-btn').classList.add('hidden');
  else $('mic-btn').addEventListener('click', () => {
    const rec = new SR(); rec.lang = 'es-ES';
    rec.onresult = (e) => { input.value = e.results[0][0].transcript; $('clear-btn').classList.remove('hidden'); onEnter(); };
    rec.onerror = () => showToast('🎤 No te he entendido, inténtalo otra vez');
    try { rec.start(); showToast('🎤 Te escucho... di un lugar'); } catch {}
  });
  $('sheet-handle').addEventListener('click', () => $('route-panel').classList.toggle('collapsed'));
  $('loop-btn').addEventListener('click', openLoop);
  $('loop-cancel').addEventListener('click', () => closeLoop());
  const showKm = (v, from) => { if (from !== 'num') $('loop-num').value = v; if (from !== 'sl') $('loop-km').value = Math.min(150, v); $('loop-val').textContent = v + ' km'; };
  $('loop-km').addEventListener('input', () => showKm(+$('loop-km').value, 'sl'));
  $('loop-num').addEventListener('input', () => { const v = parseFloat($('loop-num').value); if (v > 0) showKm(Math.min(300, v), 'num'); });
  document.querySelectorAll('[data-km]').forEach((c) => c.addEventListener('click', () => showKm(+c.dataset.km)));
  $('loop-go').addEventListener('click', () => { const km = Math.min(300, Math.max(1, parseFloat($('loop-num').value) || 10)); closeLoop(true); planLoop(km); });
  document.addEventListener('keydown', (e) => {   // atajos de PC
    const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); input.focus(); }
    if (e.key === 'Escape') {
      if (nav) stopNav();
      else if (!acBox.classList.contains('hidden')) closeAc();
      else if (!$('loop-card').classList.contains('hidden')) closeLoop();
      else if (inRoute) exitRouteMode();
      else if (selectedPlace) clearPlace();
    }
  });

  $('share-btn').addEventListener('click', async () => {
    if (!currentData) return;
    const r = currentData[currentMode];
    const text = `${modeLabel(currentMode)} FunRide · ${destinationName}\n${(r.distance / 1000).toFixed(1)} km · ${fmtTime(r.duration)} · ${r.turns} curvas\n${mapsUrl(r)}${shareLink()}`;
    try {
      if (navigator.share) await navigator.share({ title: 'FunRide 🏍️', text });
      else { await navigator.clipboard.writeText(text); showToast('✅ Copiado al portapapeles'); }
    } catch (e) { if (e.name !== 'AbortError') showToast('⚠️ No se pudo compartir'); }
  });

  $('go-btn').addEventListener('click', () => currentData && startNav());
  $('nav-stop').addEventListener('click', () => stopNav());
  $('nav-gmaps').addEventListener('click', () => currentData && window.open(mapsUrl(currentData[currentMode]), '_blank', 'noopener'));
  $('nav-mute').addEventListener('click', () => { if (!nav) return; nav.mute = !nav.mute; $('nav-mute').textContent = nav.mute ? '🔇' : '🔊'; if (nav.mute && window.speechSynthesis) speechSynthesis.cancel(); });
}

// Google Maps con puntos intermedios para que siga la ruta elegida (máx. 8)
function mapsUrl(r) {
  const n = 8, c = r.coords, wp = [];
  for (let i = 1; i <= n; i++) { const p = c[Math.floor((c.length - 1) * i / (n + 1))]; wp.push(p[0].toFixed(5) + ',' + p[1].toFixed(5)); }
  const f = (p) => p[0].toFixed(5) + ',' + p[1].toFixed(5);
  return `https://www.google.com/maps/dir/?api=1&origin=${f(c[0])}&destination=${f(c[c.length - 1])}&travelmode=${PREFS.vehicle === 'bike' ? 'bicycling' : 'driving'}` +
    ((currentMode !== 'fast' || r.loop) ? `&waypoints=${encodeURIComponent(wp.join('|'))}` : '');
}


// ═══════════════════ Candidatas de ruta ═══════════════════
// Calles secundarias reales (residenciales, terciarias...) repartidas en todas direcciones alrededor del trayecto
async function streetVias(a, b, D) {
  const pad = Math.max(0.003, (D * 0.4) / 111);
  const s = Math.min(a[0], b[0]) - pad, n = Math.max(a[0], b[0]) + pad;
  const w = Math.min(a[1], b[1]) - pad * 1.3, e = Math.max(a[1], b[1]) + pad * 1.3;
  const q = `[out:json][timeout:8];way["highway"~"^(residential|unclassified|living_street|tertiary)$"]["name"](${s},${w},${n},${e});out center 150;`;
  const d = await getJSON('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q), {}, 8000);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], sectors = {};
  for (const el of d.elements) {
    if (!el.center) continue;
    const c = [el.center.lat, el.center.lon];
    const ratio = (haversine(a, c) + haversine(c, b)) / D;
    if (ratio < 1.12 || ratio > 2.2) continue;
    (sectors[Math.floor(bearing(mid, c) / 45)] ||= []).push({ c, ratio });
  }
  return Object.values(sectors).map((l) => l.sort((x, y) => x.ratio - y.ratio)[Math.floor(l.length / 2)].c).slice(0, 8);
}

// Fracción de la ruta que pasa dos veces por el mismo sitio (ida y vuelta por una calle sin salida)
function backtrackRatio(coords) {
  const pts = resample(coords, 0.02), cells = new Set();
  let dup = 0;
  for (const p of pts) { const k = Math.round(p[0] * 10000) + ',' + Math.round(p[1] * 10000); cells.has(k) ? dup++ : cells.add(k); }
  return dup / Math.max(pts.length, 1);
}

async function buildCandidates(a, b) {
  const D = haversine(a, b), short = D < 8;
  let vias = [];
  if (D > 0.3) {
    if (short) { try { vias = await streetVias(a, b, D); } catch {} }
    if (vias.length < 4) {
      const brg = bearing(a, b);
      const plan = short ? [[0.33, 0.2], [0.66, 0.2], [0.5, 0.35]] : [[0.5, 0.12], [0.5, 0.25], [0.5, 0.4]];
      for (const [t, f] of plan) for (const side of [90, -90]) {
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        vias.push(offsetPoint(p, brg + side, Math.max(D * f, 0.12)));
      }
    }
  }
  const jobs = [() => osrm([a, b], true), ...vias.map((v) => () => osrm([a, v, b]))];
  const raw = []; let firstErr;
  for (let i = 0; i < jobs.length; i += 5) {   // lotes de 5 para no saturar el servidor público
    const st = await Promise.allSettled(jobs.slice(i, i + 5).map((j) => j()));
    st.forEach((x, k) => { if (x.status === 'fulfilled') raw.push(...x.value); else if (i + k === 0) firstErr = x.reason; });
  }
  if (!raw.length) throw firstErr || new Error('No hay rutas disponibles 🛣️');

  const seen = new Set(), maxK = short ? 2.5 : 2;
  return raw
    .filter((r) => { const k = Math.round(r.distance / 60) + '-' + Math.round(r.duration / 8); return seen.has(k) ? false : seen.add(k); })
    .filter((r) => r.distance < raw[0].distance * maxK)
    .map((r, i) => {
      const coords = r.geometry.coordinates.map((c) => [c[1], c[0]]);
      return { coords, distance: r.distance, duration: r.duration, steps: flattenSteps(r), base: i === 0, back: backtrackRatio(coords), ...analyzeCurves(coords, r.distance / 1000) };
    })
    .filter((r) => r.base || r.back < 0.12);
}


// ═══════════════════ Funciones nuevas ═══════════════════
function buildData(routes) {
  const fastest = [...routes].sort((a, b) => a.duration - b.duration)[0];
  const cap = fastest.distance < 8000 ? 2.5 : 1.7;   // más margen de tiempo en trayectos cortos
  const ok = routes.filter((r) => r.duration <= fastest.duration * cap);
  const funnest = [...ok].sort((a, b) => b.score - a.score)[0] || fastest;
  const val = (r) => r.score * Math.pow(fastest.duration / r.duration, 1.5);   // diversión penalizada por tiempo
  const balanced = [...ok].sort((a, b) => val(b) - val(a))[0] || fastest;
  return { fastest, funnest, balanced, all: routes, fast: fastest, bal: balanced, fun: funnest };
}

function shareLink() {
  if (!location.protocol.startsWith('http') || !destinationCoords || currentData?.fast?.loop) return '';
  return `\n${location.origin}${location.pathname}?d=${destinationCoords[0].toFixed(5)},${destinationCoords[1].toFixed(5)}&n=${encodeURIComponent(destinationName)}`;
}

function openSharedLink() {
  const q = new URLSearchParams(location.search), d = (q.get('d') || '').split(',').map(Number);
  if (d.length !== 2 || d.some((x) => !isFinite(x)) || Math.abs(d[0]) > 90 || Math.abs(d[1]) > 180) return;
  history.replaceState(null, '', location.pathname);
  selectPlace({ name: (q.get('n') || 'Destino compartido').slice(0, 80), addr: 'Enlace compartido', lat: d[0], lon: d[1] });
}

function openLoop() {
  if (inRoute) exitRouteMode();
  ['place-card', 'map-hint'].forEach((id) => $(id).classList.add('hidden'));
  $('loop-card').classList.remove('hidden');
}
function closeLoop(keep) {
  $('loop-card').classList.add('hidden');
  if (keep) return;
  $(selectedPlace ? 'place-card' : 'map-hint').classList.remove('hidden');
}

// Ruta circular: sale de tu posición, recorre dos puntos en triángulo y vuelve. Prueba 8 orientaciones y puntúa las curvas.
async function planLoop(km) {
  const id = ++searchId;
  showLoading('Diseñando circuitos desde tu posición...');
  try {
    await ensureLocation();
    const o = userLatLng, side = km / 3 / 1.35, jobs = [];
    for (let b = 0; b < 360; b += 45) jobs.push(() => osrm([o, offsetPoint(o, b, side), offsetPoint(o, b + 60, side), o]));
    const raw = [];
    for (let i = 0; i < jobs.length; i += 4) (await Promise.allSettled(jobs.slice(i, i + 4).map((j) => j()))).forEach((x) => { if (x.status === 'fulfilled') raw.push(...x.value); });
    if (id !== searchId) { hideLoading(); return; }
    const routes = raw.map((r) => {
      const coords = r.geometry.coordinates.map((c) => [c[1], c[0]]);
      return { coords, distance: r.distance, duration: r.duration, steps: flattenSteps(r), loop: true, back: backtrackRatio(coords), ...analyzeCurves(coords, r.distance / 1000) };
    }).filter((r) => r.back < 0.3 && Math.abs(r.distance / 1000 - km) < Math.max(km * 0.4, 1));
    if (!routes.length) throw new Error('No encontré un buen circuito aquí. Prueba otra distancia');
    destinationName = `Ruta circular ${km} km`; destinationCoords = o;
    currentData = buildData(routes);
    hideLoading(); enterRouteMode();
  } catch (err) { hideLoading(); closeLoop(); showToast('⚠️ ' + friendly(err)); }
}


// ═══════════════════ Navegación paso a paso ═══════════════════
const MOD = { left: 'a la izquierda', right: 'a la derecha', 'slight left': 'ligeramente a la izquierda', 'slight right': 'ligeramente a la derecha', 'sharp left': 'cerrado a la izquierda', 'sharp right': 'cerrado a la derecha', straight: 'recto' };
const ARROW = { left: '⬅️', right: '➡️', 'slight left': '↖️', 'slight right': '↗️', 'sharp left': '↙️', 'sharp right': '↘️', straight: '⬆️', uturn: '↩️' };

function flattenSteps(r) {
  const out = []; let acc = 0;
  (r.legs || []).forEach((leg, li, legs) => (leg.steps || []).forEach((s, si, steps) => {
    const t = s.maneuver.type, last = li === legs.length - 1 && si === steps.length - 1;
    const skip = (t === 'arrive' && !last) || (t === 'depart' && !(li === 0 && si === 0));
    if (!skip) out.push({ type: t, mod: s.maneuver.modifier, exit: s.maneuver.exit, name: s.name, at: acc });
    acc += s.distance || 0;
  }));
  return out;
}

function stepInfo(s) {
  const m = MOD[s.mod] || '', n = s.name ? ` por ${s.name}` : '', a = ARROW[s.mod] || '⬆️';
  if (s.mod === 'uturn') return { icon: '↩️', text: `Da la vuelta${n}` };
  switch (s.type) {
    case 'depart': return { icon: '🏍️', text: `Sal${n}` };
    case 'arrive': return { icon: '🏁', text: 'Has llegado a tu destino' };
    case 'roundabout': case 'rotary': case 'roundabout turn': return { icon: '🔄', text: `En la rotonda, toma la ${s.exit ? 'salida ' + s.exit : 'salida'}${n}` };
    case 'merge': return { icon: a, text: `Incorpórate ${m}${n}`.replace('  ', ' ') };
    case 'fork': return { icon: a, text: `Mantente ${m}${n}` };
    case 'on ramp': case 'off ramp': return { icon: a, text: `Toma la salida ${m}${n}` };
    case 'continue': case 'new name': return { icon: a, text: `Continúa ${m || 'recto'}${n}` };
    default: return { icon: a, text: s.mod === 'straight' ? `Continúa recto${n}` : `Gira ${m}${n}` };
  }
}

function say(t) {
  if (!nav || nav.mute || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(t); u.lang = 'es-ES';
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

async function startNav(quiet, mute) {
  const r = currentData[currentMode];
  if (!r.steps || r.steps.length < 2) { showToast('ℹ️ Sin instrucciones detalladas · abriendo Google Maps'); return window.open(mapsUrl(r), '_blank', 'noopener'); }
  const c = r.coords, cum = [0];
  for (let i = 1; i < c.length; i++) cum[i] = cum[i - 1] + haversine(c[i - 1], c[i]) * 1000;
  const total = cum[cum.length - 1], k = total / (r.distance || total);
  let p = 0;
  const stepAt = r.steps.map((s) => { while (p < c.length - 1 && cum[p] < s.at * k) p++; return p; });
  nav = { r, cum, stepAt, total, i: 0, s: Math.min(1, r.steps.length - 1), off: 0, said: new Set(), mute: !!mute || !PREFS.voice, lastReroute: 0 };
  document.body.classList.add('navigating');
  ['nav-banner', 'nav-bar'].forEach((id) => $(id).classList.remove('hidden'));
  $('nav-mute').textContent = nav.mute ? '🔇' : '🔊';
  following = true;
  if (userLatLng) map.setView(userLatLng, 17);
  if (!quiet) say('Iniciando ruta. ' + stepInfo(r.steps[nav.s]).text);
  try { wake = await navigator.wakeLock?.request('screen'); } catch {}
  navUpdate();
}

function stopNav() {
  nav = null;
  document.body.classList.remove('navigating');
  ['nav-banner', 'nav-bar'].forEach((id) => $(id).classList.add('hidden'));
  if (window.speechSynthesis) speechSynthesis.cancel();
  try { wake?.release(); } catch {}
  wake = null;
}

function navTick(p) {
  if (!nav) return;
  const pos = [p.coords.latitude, p.coords.longitude], c = nav.r.coords;
  let best = nav.i, bd = 1e9;
  const scan = (a, b) => { for (let k = a; k < b; k++) { const d = haversine(pos, c[k]) * 1000; if (d < bd) { bd = d; best = k; } } };
  scan(nav.i, Math.min(c.length, nav.i + 250));
  const lim = Math.max(60, p.coords.accuracy || 0);
  if (bd > lim) scan(0, c.length);
  if (bd > lim) { if (++nav.off >= 3) reroute(pos); } else { nav.off = 0; nav.i = best; }
  $('nav-speed').textContent = Math.round((p.coords.speed || 0) * 3.6);
  navUpdate();
}

function navUpdate() {
  const n = nav; if (!n) return;
  const st = n.r.steps;
  while (n.s < st.length - 1 && n.stepAt[n.s] <= n.i) n.s++;
  const rem = n.total - n.cum[n.i], info = stepInfo(st[n.s]);
  const dist = Math.max(0, n.cum[n.stepAt[n.s]] - n.cum[n.i]), t = n.r.duration * (rem / n.total);
  $('nav-icon').textContent = info.icon;
  $('nav-text').textContent = info.text;
  $('nav-dist').textContent = fmtDist(dist / 1000);
  $('nav-time').textContent = `${fmtTime(t)} · ${fmtDist(rem / 1000)}`;
  $('nav-eta').textContent = new Date(Date.now() + t * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const k = n.s;
  if (dist < 380 && dist > 70 && st[k].type !== 'arrive' && !n.said.has(k + 'a')) { n.said.add(k + 'a'); say(`En ${Math.round(dist / 50) * 50} metros, ${info.text}`); }
  if (dist < 70 && !n.said.has(k + 'b')) { n.said.add(k + 'b'); say(info.text); }
  if (rem < 30) { recordTrip(n.r); say('Has llegado a tu destino'); showToast('🏁 ¡Has llegado!'); return stopNav(); }
  if (following && userLatLng) map.panTo(userLatLng);
}

async function reroute(pos) {
  if (Date.now() - nav.lastReroute < 15000) return;
  nav.lastReroute = Date.now(); nav.off = 0;
  showToast('🔄 Recalculando ruta...'); say('Recalculando');
  try {
    const rs = await osrm([pos, destinationCoords]);
    if (!rs[0] || !nav) return;
    const coords = rs[0].geometry.coordinates.map((c) => [c[1], c[0]]), mute = nav.mute;
    const route = { coords, distance: rs[0].distance, duration: rs[0].duration, steps: flattenSteps(rs[0]), loop: nav.r.loop, ...analyzeCurves(coords, rs[0].distance / 1000) };
    stopNav(); currentData[currentMode] = route; renderRoute();
    await startNav(true, mute);
  } catch { showToast('⚠️ No se pudo recalcular'); }
}


// ═══════════════════ Estadísticas, GPX y atajos ═══════════════════
function recordTrip(r) {
  try {
    const h = JSON.parse(localStorage.getItem('funride_trips') || '[]');
    h.unshift({ t: Date.now(), km: +(r.distance / 1000).toFixed(1), turns: r.turns, loop: !!r.loop, name: destinationName });
    localStorage.setItem('funride_trips', JSON.stringify(h.slice(0, 300)));
  } catch {}
  renderHome();
}

function exportGPX() {
  if (!currentData) return;
  const r = currentData[currentMode], nm = escapeHtml(destinationName || 'Ruta FunRide');
  const pts = r.coords.map((c) => `<trkpt lat="${c[0].toFixed(6)}" lon="${c[1].toFixed(6)}"/>`).join('');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="FunRide" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${nm}</name><trkseg>${pts}</trkseg></trk></gpx>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = (destinationName || 'ruta').replace(/[^\w\-]+/g, '_') + '.gpx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  showToast('📥 GPX descargado (ábrelo en tu GPS o app de rutas)');
}

function renderQuick() {
  const q = $('quick'), r = loadRecent().slice(0, 3);
  q.innerHTML = r.map((x, i) => `<button class="chip" data-i="${i}">🕐 ${escapeHtml(x.name)}</button>`).join('');
  q.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => choosePlace(r[+c.dataset.i])));
  renderHome();
}


// ═══════════════════ Panel de inicio y tiempo (pantallas grandes) ═══════════════════
const TIPS = ['💡 Las carreteras sinuosas suelen tener mejores vistas que las autovías.', '🔧 Revisa la presión de los neumáticos antes de una ruta de curvas.', '🌅 Sal temprano: menos tráfico y el asfalto está más limpio.', '🧤 Lleva siempre protección completa, también en trayectos cortos.', '⛽ En montaña las gasolineras escasean: repostar antes de subir.', '🏍️ Mira por donde quieres ir, no a lo que quieres evitar.'];

function renderHome() {
  const now = new Date(), hr = now.getHours();
  const g = hr < 6 ? 'Buenas noches 🌙' : hr < 12 ? 'Buenos días ☀️' : hr < 20 ? 'Buenas tardes 👋' : 'Buenas noches 🌙';
  let trips = []; try { trips = JSON.parse(localStorage.getItem('funride_trips') || '[]'); } catch {}
  const km = trips.reduce((s, t) => s + t.km, 0), rec = loadRecent().slice(0, 5);
  const card = (k, ic, t, s) => `<button class="home-card" data-h="${k}"><span>${ic}</span><b>${t}</b><small>${s}</small></button>`;
  $('home').innerHTML = `<div class="home-hello"><b>${g}</b><small>${now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</small></div>
    <div class="home-grid">${card('loop', '🔄', 'Ruta circular', 'Sal y vuelve al inicio')}${card('saved', '⭐', 'Guardados', 'Tus lugares y rutas')}${card('comm', '🌍', 'Comunidad', 'Rutas de otros pilotos')}${card('friends', '👥', 'Amigos', 'Mira dónde están')}</div>
    ${rec.length ? '<h4>Recientes</h4>' + rec.map((r, i) => `<button class="home-row" data-r="${i}"><span>🕐 ${escapeHtml(r.name)}</span><small>${escapeHtml(r.addr || '')}</small></button>`).join('') : ''}
    <div class="home-stats"><div><b>${km.toFixed(0)}</b><small>km recorridos</small></div><div><b>${trips.length}</b><small>viajes hechos</small></div></div>
    <div class="home-tip">${TIPS[Math.floor(Math.random() * TIPS.length)]}</div>
    <div class="home-keys"><kbd>/</kbd> buscar · <kbd>Esc</kbd> cerrar · clic en el mapa = destino</div>`;
  $('home').querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.h; if (k === 'loop') openLoop(); else document.querySelector(`.tab[data-tab="${k}"]`).click(); }));
  $('home').querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => choosePlace(rec[+b.dataset.r])));
}

let wxDone = false;
async function loadWeather() {
  if (wxDone) return;
  wxDone = true;
  const [lat, lon] = refPoint();
  try {
    const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,wind_speed_10m,weather_code&hourly=precipitation_probability&forecast_days=1&timezone=auto`, {}, 8000);
    const c = d.current, i = Math.max(0, d.hourly.time.findIndex((t) => t >= c.time));
    const rain = Math.max(...d.hourly.precipitation_probability.slice(i, i + 5)), code = c.weather_code;
    const t = Math.round(c.temperature_2m), w = Math.round(c.wind_speed_10m);
    const ic = code === 0 ? '☀️' : code <= 2 ? '🌤️' : code === 3 ? '☁️' : code <= 48 ? '🌫️' : code <= 57 ? '🌦️' : code <= 67 ? '🌧️' : code <= 77 ? '❄️' : code <= 82 ? '🌧️' : '⛈️';
    let v = ['✅', 'Buen día para rodar', 'ok'];
    if (code >= 95 || (code >= 71 && code <= 77) || (code >= 85 && code <= 86)) v = ['⛔', 'Mejor no salir en moto', 'bad'];
    else if (rain >= 60 || (code >= 61 && code <= 67) || code >= 80) v = ['🌧️', 'Riesgo de lluvia', 'warn'];
    else if (t < 5) v = ['🥶', 'Mucho frío, abrígate', 'warn'];
    else if (t > 35) v = ['🥵', 'Calor extremo', 'warn'];
    else if (w > 45) v = ['💨', 'Viento fuerte', 'warn'];
    $('weather').innerHTML = `<div class="wx-top"><span class="wx-ic">${ic}</span><div><b>${t}°C</b><small>Viento ${w} km/h · Lluvia ${rain}%</small></div></div><div class="wx-v ${v[2]}">${v[0]} ${v[1]}</div>`;
    $('weather').classList.add('on');
  } catch { wxDone = false; }
}
setTimeout(loadWeather, 6000);
setInterval(() => document.body.classList.toggle('idle', !selectedPlace && !inRoute && !nav && $('loop-card').classList.contains('hidden')), 250);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

// Arranque: al final, cuando todas las constantes y funciones ya están definidas
init();
