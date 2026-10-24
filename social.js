// social.js · Música (Spotify + radio), grupos con color propio y Jam sincronizada
(() => {
const FR = window.FR;
if (!FR) return;
const CFG = window.FUNRIDE_CONFIG || {}, esc = escapeHtml, row = FR.row, btn = FR.btn;
const SPID = CFG.SPOTIFY_CLIENT_ID || '', SPK = 'funride_sp';
let musicSrc = 'sp', np = null, spDevs = [], lastRes = [];

// ───────── Spotify (PKCE: sin servidor, sin secretos) ─────────
const spRedirect = () => location.origin + location.pathname;
const spTok = () => { try { return JSON.parse(localStorage.getItem(SPK) || 'null'); } catch { return null; } };
const spOn = () => !!(SPID && spTok());
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function spLogin() {
  if (!window.crypto || !crypto.subtle) throw new Error('Spotify necesita HTTPS (o http://127.0.0.1)');
  const v = b64(crypto.getRandomValues(new Uint8Array(48)));
  localStorage.setItem('funride_sp_v', v);
  const ch = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  location.href = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: SPID, response_type: 'code', redirect_uri: spRedirect(), code_challenge_method: 'S256', code_challenge: ch,
    scope: 'user-read-playback-state user-modify-playback-state user-read-currently-playing' });
}
async function spToken(body) {
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: SPID, ...body }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error_description || 'Error de Spotify');
  const old = spTok() || {};
  localStorage.setItem(SPK, JSON.stringify({ access: d.access_token, refresh: d.refresh_token || old.refresh, exp: Date.now() + d.expires_in * 1000 - 60000 }));
}
async function spRedirectBack() {
  const code = new URLSearchParams(location.search).get('code');
  if (!code || !SPID) return;
  history.replaceState(null, '', location.pathname);
  try { await spToken({ grant_type: 'authorization_code', code, redirect_uri: spRedirect(), code_verifier: localStorage.getItem('funride_sp_v') }); showToast('🎧 Spotify conectado'); FR.openDrawer('music'); }
  catch (e) { showToast('⚠️ ' + e.message); }
}
async function sp(method, path, body) {
  let t = spTok();
  if (!t) throw new Error('Conecta Spotify primero');
  if (Date.now() > t.exp) { await spToken({ grant_type: 'refresh_token', refresh_token: t.refresh }); t = spTok(); }
  const r = await fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + t.access, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204 || r.status === 202) return null;
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(r.status === 404 ? 'No hay ningún dispositivo de Spotify activo. Abre la app de Spotify en tu móvil u ordenador y pon una canción un momento.' : r.status === 403 ? 'Spotify solo permite controlar la reproducción con cuenta Premium.' : r.status === 401 ? 'La sesión de Spotify caducó. Vuelve a conectar.' : (d && d.error && d.error.message) || 'Error de Spotify');
  return d;
}
const trk = (t) => ({ uri: t.uri, name: t.name, artist: t.artists.map((a) => a.name).join(', '), dur: t.duration_ms, img: ((t.album.images[1] || t.album.images[0]) || {}).url || '' });
async function search(q) { const d = await sp('GET', '/search?type=track&limit=8&q=' + encodeURIComponent(q)); lastRes = d.tracks.items.map(trk); }
const resHTML = (ctx) => lastRes.map((t, i) => row(t.name, t.artist, ctx === 'jam' ? btn('jamadd', i, '➕ Jam') : btn('spplay', i, '▶') + btn('spqueue', i, '➕'), t.img ? `<img class="art" src="${esc(t.img)}" alt="">` : '')).join('') || '<p class="empty">Sin resultados</p>';
async function loadNP() { try { np = await sp('GET', '/me/player'); } catch { np = null; } }
function npHTML() {
  const i = np && np.item;
  if (!i) return '<p class="empty">Nada sonando ahora mismo.</p>';
  const img = i.album ? ((i.album.images[1] || i.album.images[0]) || {}).url : '';
  return `<div class="np">${img ? `<img class="art big" src="${esc(img)}" alt="">` : ''}<div class="np-t"><b>${esc(i.name)}</b><small>${esc((i.artists || []).map((a) => a.name).join(', '))}</small></div>
    <div class="np-c"><button class="mini" data-act="spprev">⏮</button><button class="mini big" data-act="sptoggle">${np.is_playing ? '⏸' : '▶️'}</button><button class="mini" data-act="spnext">⏭</button></div></div>`;
}

// ───────── Radio por internet (Radio Browser, gratis y sin cuenta) ─────────
const radio = new Audio();
let station = null, stations = [];
const PRESETS = [['🎸 Rock', 'rock'], ['🎤 Pop', 'pop'], ['🎧 Electrónica', 'electronic'], ['😌 Chill', 'chillout'], ['🎶 Hip-hop', 'hiphop'], ['🎻 Clásica', 'classical'], ['📰 Noticias', 'news']];
const RB = ['https://de1.api.radio-browser.info', 'https://at1.api.radio-browser.info', 'https://nl1.api.radio-browser.info'];
async function rbSearch(params) {
  for (const h of RB) {
    try {
      const d = await getJSON(`${h}/json/stations/search?` + new URLSearchParams({ limit: 80, hidebroken: 'true', order: 'clickcount', reverse: 'true', ...params }), {}, 8000);
      return d.filter((s) => s.url_resolved && (location.protocol !== 'https:' || s.url_resolved.startsWith('https'))).slice(0, 25);
    } catch {}
  }
  throw new Error('No se pudo cargar la lista de emisoras');
}
const radNP = () => !station ? '' : `<div class="np"><div class="np-t"><b>📻 ${esc(station.name)}</b><small>${radio.paused ? 'En pausa' : '🔴 En directo'}</small></div><div class="np-c"><button class="mini big" data-act="radtoggle">${radio.paused ? '▶️' : '⏸'}</button><button class="mini" data-act="radstop">⏹</button></div></div>`;
const radRes = () => stations.map((s, i) => row(s.name, [s.country, (s.tags || '').split(',').slice(0, 2).join(', ')].filter(Boolean).join(' · '), btn('radplay', i, '▶'))).join('') || '<p class="empty">Elige un género o busca una emisora.</p>';
function radioTab() {
  return `<div class="chips">${PRESETS.map((p, i) => `<button class="chip" data-act="radpreset" data-i="${i}">${p[0]}</button>`).join('')}</div>
    <div class="form inline"><input id="rad-q" data-enter="radsearch" placeholder="Buscar emisora (ej: Los 40)"><button class="mini" data-act="radsearch">🔍</button></div>
    <div id="radio-np">${radNP()}</div><div id="rad-res">${radRes()}</div>`;
}
function playRadio(s) {
  station = s; radio.src = s.url_resolved;
  radio.play().catch(() => showToast('⚠️ Esa emisora no responde. Prueba otra.'));
  if (spOn()) sp('PUT', '/me/player/pause').catch(() => {});
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: s.name, artist: 'FunRide Radio' });
}
['play', 'pause', 'error'].forEach((ev) => radio.addEventListener(ev, () => { setPlayingUI(); const el = $('radio-np'); if (el) el.innerHTML = radNP(); }));
function setPlayingUI() {
  const on = (station && !radio.paused) || (np && np.is_playing);
  $('music-btn').classList.toggle('playing', !!on);
  $('nav-music').textContent = on ? '⏸' : '🎵';
}

window.MUSIC = {
  async toggle() {
    if (station) { radio.paused ? radio.play().catch(() => {}) : radio.pause(); return; }
    if (spOn()) {
      try { await loadNP(); await sp('PUT', np && np.is_playing ? '/me/player/pause' : '/me/player/play'); await loadNP(); setPlayingUI(); }
      catch (e) { showToast('🎧 ' + e.message); }
      return;
    }
    showToast('🎵 Elige qué escuchar en ☰ → Música'); FR.openDrawer('music');
  }
};

async function spTab() {
  if (!SPID) return `<div class="empty"><b>Spotify sin configurar</b><br><br>1. Entra en developer.spotify.com/dashboard y crea una app<br>2. En "Redirect URI" pon exactamente:<br><code>${esc(spRedirect())}</code><br>3. Copia su Client ID en <code>config.js</code> (SPOTIFY_CLIENT_ID)<br>4. En "User Management" añade tu cuenta de Spotify<br><br><small>Mientras tanto puedes usar la 📻 Radio.</small></div>`;
  if (!spOn()) return `<div class="empty">Conecta tu cuenta de Spotify para controlar tu música desde aquí.<br><small>Necesita Spotify Premium y la app de Spotify abierta en algún dispositivo.</small></div><button class="action-btn primary" data-act="spconnect">🎧 Conectar Spotify</button>`;
  try { spDevs = (await sp('GET', '/me/player/devices')).devices || []; } catch (e) { return `<p class="empty">⚠️ ${esc(e.message)}</p><button class="action-btn" data-act="spdisc">Desconectar y volver a conectar</button>`; }
  await loadNP(); setPlayingUI();
  return `<div id="sp-np">${npHTML()}</div><h4>Dispositivos</h4>
    ${spDevs.map((d, i) => row(d.name, d.type + (d.is_active ? ' · activo' : ''), btn('spdev', i, d.is_active ? '✅' : 'Usar'))).join('') || '<p class="empty">No se ve ningún dispositivo. Abre la app de Spotify en tu móvil u ordenador.</p>'}
    <h4>Buscar</h4><div class="form inline"><input id="sp-q" data-enter="spsearch" placeholder="Canción o artista"><button class="mini" data-act="spsearch">🔍</button></div><div id="sp-res"></div>
    <br><button class="link" data-act="spdisc">Desconectar Spotify</button>`;
}

// ───────── Grupos y Jam ─────────
const GC = ['#a855f7', '#06b6d4', '#f43f5e', '#22c55e', '#f59e0b'];
const gColor = (id) => GC[[...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % GC.length];
let groups = [], gActive = localStorage.getItem('funride_group') || null, members = [], jam = null, srvOff = 0, chan = null, lastUri = null, lastPlaying = null, advancing = 0, lastUid = null;
window.groupColorFor = (uid) => (gActive && members.includes(uid) ? gColor(gActive) : null);
const sbx = () => FR.sb;
async function rpc(name, args) {
  const { data, error } = await sbx().rpc(name, args);
  if (error) throw new Error(/function|schema cache/i.test(error.message) ? 'Falta ejecutar schema_v4.sql en Supabase' : error.message);
  return data;
}
async function syncClock() { const t0 = Date.now(); try { const d = await rpc('server_now'); srvOff = Date.parse(d) - (t0 + Date.now()) / 2; } catch {} }
const srvNow = () => Date.now() + srvOff;

async function loadMembers() {
  members = [];
  if (gActive) {
    const { data } = await sbx().from('group_members').select('user_id').eq('group_id', gActive);
    members = (data || []).map((x) => x.user_id).filter((id) => id !== FR.user.id);
    const need = members.filter((id) => !FR.prof[id]);
    if (need.length) { const r = await sbx().from('profiles').select('id,username,avatar_img,avatar_emoji,avatar_color,vehicle').in('id', need); (r.data || []).forEach((p) => { FR.prof[p.id] = p; FR.names[p.id] = p.username; }); }
  }
  FR.refreshIcons();
  await FR.reloadLive();
}
async function loadGroups() {
  const { data, error } = await sbx().from('group_members').select('group_id, groups(id,name,code,owner)').eq('user_id', FR.user.id);
  if (error) throw new Error(/relation|schema cache/i.test(error.message) ? 'Falta ejecutar schema_v4.sql en Supabase' : error.message);
  groups = (data || []).map((x) => x.groups).filter(Boolean);
  if (!groups.find((g) => g.id === gActive)) gActive = groups[0] ? groups[0].id : null;
  localStorage.setItem('funride_group', gActive || '');
  await loadMembers();
  await startJam();
}

async function startJam() {
  if (chan) { sbx().removeChannel(chan); chan = null; }
  jam = null; lastUri = null; lastPlaying = null;
  if (!gActive) return;
  const { data } = await sbx().from('jams').select('*').eq('group_id', gActive).maybeSingle();
  jam = data || null;
  if (jam) { lastUri = jam.current ? jam.current.uri : null; lastPlaying = jam.playing; }   // no arranca solo: se une con 🔄
  chan = sbx().channel('jam-' + gActive).on('postgres_changes', { event: '*', schema: 'public', table: 'jams', filter: 'group_id=eq.' + gActive }, (pl) => { if (pl.new) applyJam(pl.new); }).subscribe();
}
async function applyJam(j, force) {
  jam = j;
  const box = $('jam-box'); if (box) box.innerHTML = jamBox();
  const uri = j.current ? j.current.uri : null;
  const changed = force || uri !== lastUri || j.playing !== lastPlaying;
  lastUri = uri; lastPlaying = j.playing;
  if (!changed || !uri || !spOn()) return;
  const pos = j.playing ? Math.max(0, srvNow() - Date.parse(j.started_at)) : j.paused_pos;
  try {
    if (j.playing) { if (station) radio.pause(); await sp('PUT', '/me/player/play', { uris: [uri], position_ms: Math.round(pos) }); }
    else await sp('PUT', '/me/player/pause');
  } catch (e) { if (j.playing) showToast('🎧 ' + e.message); }
}
setInterval(async () => {   // el primero que detecta que la canción terminó pasa a la siguiente (la función del servidor evita duplicados)
  if (!jam || !jam.playing || !jam.current || !jam.current.dur || Date.now() - advancing < 4000) return;
  if (srvNow() - Date.parse(jam.started_at) >= jam.current.dur - 300) { advancing = Date.now(); try { applyJam(await rpc('jam_next', { p_group: gActive, p_expect: jam.current.uri })); } catch {} }
}, 1500);
setInterval(() => { if (gActive && FR.user) loadMembers().catch(() => {}); }, 20000);
setInterval(async () => { if (spOn() && (FR.isOpen() && FR.tab() === 'music' || Math.random() < 0.25)) { await loadNP(); setPlayingUI(); const el = $('sp-np'); if (el) el.innerHTML = npHTML(); } }, 5000);

function jamBox() {
  const c = jam && jam.current, q = (jam && jam.queue) || [];
  return (c ? `<div class="np">${c.img ? `<img class="art big" src="${esc(c.img)}" alt="">` : ''}<div class="np-t"><b>${esc(c.name)}</b><small>${esc(c.artist)} · ${jam.playing ? '▶ sonando' : '⏸ en pausa'}</small></div>
      <div class="np-c"><button class="mini big" data-act="jamtoggle">${jam.playing ? '⏸' : '▶️'}</button><button class="mini" data-act="jamskip">⏭</button><button class="mini" data-act="jamsync" title="Sincronizar conmigo">🔄</button></div></div>`
    : '<p class="empty">La jam está vacía. Añade la primera canción.</p>') +
    (q.length ? '<h4>En cola</h4>' + q.map((t, i) => `<div class="qrow">${i + 1}. <b>${esc(t.name)}</b> <small>${esc(t.artist)}</small></div>`).join('') : '');
}
async function tplGroup() {
  await loadGroups();
  const g = groups.find((x) => x.id === gActive);
  let h = groups.length ? '' : '<p class="empty">Crea un grupo para salir con amigos: os veréis en el mapa con un color propio y podréis escuchar música a la vez.</p>';
  h += `<button class="action-btn primary" data-act="gcreate">➕ Crear grupo</button><div class="form inline" style="margin-top:10px"><input id="g-code" data-enter="gjoin" placeholder="Código de un grupo" maxlength="8">${btn('gjoin', 0, 'Unirme')}</div>`;
  if (groups.length) h += '<h4>Mis grupos</h4>' + groups.map((x, i) => row((x.id === gActive ? '🟢 ' : '') + x.name, 'Código: ' + x.code, (x.id === gActive ? '' : btn('gactive', i, 'Activar')) + btn('gcopy', i, '📋') + btn('gleave', i, '🚪'), `<span class="gdot" style="background:${gColor(x.id)}"></span>`)).join('');
  if (g) {
    h += `<h4>Miembros · aparecen en color en el mapa</h4>` + (members.map((id, i) => row(FR.names[id] || 'Piloto', (FR.prof[id] || {}).vehicle || '', btn('gfind', i, '🎯'), FR.avatarHTML(FR.prof[id], 44)).replace('class="avatar"', `class="avatar" data-g="1"`)).join('') || '<p class="empty">Solo estás tú. Comparte el código para que se unan.</p>');
    h += '<h4>🎶 Jam del grupo</h4>' + (spOn() ? '' : '<div class="rnote">Conecta Spotify en 🎵 Música para escuchar la jam (cada persona necesita Premium).</div>') +
      `<div id="jam-box">${jamBox()}</div><div class="form inline"><input id="jam-q" data-enter="jamsearch" placeholder="Añadir canción a la jam"><button class="mini" data-act="jamsearch">🔍</button></div><div id="jam-res"></div>`;
  }
  return h;
}

async function askShare() { if (await FR.dialog({ title: '¿Compartir tu posición con el grupo?', input: false, ok: 'Compartir' })) FR.setSharing(true); }

window.FR_TABS = { music: async () => `<div class="seg"><button class="seg-b ${musicSrc === 'sp' ? 'on' : ''}" data-act="musrc" data-v="sp">🎧 Spotify</button><button class="seg-b ${musicSrc === 'radio' ? 'on' : ''}" data-act="musrc" data-v="radio">📻 Radio</button></div>` + (musicSrc === 'sp' ? await spTab() : radioTab()), group: tplGroup };

window.FR_ACT = async (a, b, i, v) => {
  const g = groups[i];
  switch (a) {
    case 'musrc': musicSrc = b.dataset.v; FR.renderTab(); return true;
    case 'spconnect': await spLogin(); return true;
    case 'spdisc': localStorage.removeItem(SPK); np = null; FR.renderTab(); return true;
    case 'sptoggle': await sp('PUT', np && np.is_playing ? '/me/player/pause' : '/me/player/play'); await loadNP(); setPlayingUI(); $('sp-np').innerHTML = npHTML(); return true;
    case 'spnext': await sp('POST', '/me/player/next'); setTimeout(async () => { await loadNP(); const el = $('sp-np'); if (el) el.innerHTML = npHTML(); }, 600); return true;
    case 'spprev': await sp('POST', '/me/player/previous'); setTimeout(async () => { await loadNP(); const el = $('sp-np'); if (el) el.innerHTML = npHTML(); }, 600); return true;
    case 'spdev': await sp('PUT', '/me/player', { device_ids: [spDevs[i].id], play: true }); FR.renderTab(); return true;
    case 'spsearch': { const q = v('sp-q'); if (!q) return true; await search(q); $('sp-res').innerHTML = resHTML('sp'); return true; }
    case 'spplay': if (station) { radio.pause(); } await sp('PUT', '/me/player/play', { uris: [lastRes[i].uri] }); showToast('▶ ' + lastRes[i].name); setTimeout(async () => { await loadNP(); setPlayingUI(); const el = $('sp-np'); if (el) el.innerHTML = npHTML(); }, 700); return true;
    case 'spqueue': await sp('POST', '/me/player/queue?uri=' + encodeURIComponent(lastRes[i].uri)); showToast('➕ Añadida a tu cola'); return true;
    case 'radpreset': stations = await rbSearch({ tag: PRESETS[i][1], countrycode: 'ES' }); $('rad-res').innerHTML = radRes(); return true;
    case 'radsearch': { const q = v('rad-q'); if (!q) return true; stations = await rbSearch({ name: q }); $('rad-res').innerHTML = radRes(); return true; }
    case 'radplay': playRadio(stations[i]); return true;
    case 'radtoggle': radio.paused ? radio.play().catch(() => {}) : radio.pause(); return true;
    case 'radstop': radio.pause(); radio.removeAttribute('src'); station = null; setPlayingUI(); $('radio-np').innerHTML = ''; return true;
    // Grupos
    case 'gcreate': {
      const d = await FR.dialog({ title: '🧑‍🤝‍🧑 Nombre del grupo', value: 'Salida del domingo' });
      if (!d || !d.name) return true;
      const n = await rpc('create_group', { p_name: d.name }); gActive = n.id; await askShare(); FR.renderTab(); return true;
    }
    case 'gjoin': { const code = v('g-code'); if (!code) return true; const n = await rpc('join_group', { p_code: code }); gActive = n.id; showToast('🎉 Te has unido a ' + n.name); await askShare(); FR.renderTab(); return true; }
    case 'gactive': gActive = g.id; localStorage.setItem('funride_group', gActive); FR.renderTab(); return true;
    case 'gcopy': await navigator.clipboard.writeText(g.code); showToast('✅ Código copiado: ' + g.code); return true;
    case 'gleave': { if (!(await FR.dialog({ title: `¿Salir de «${g.name}»?`, input: false, ok: 'Salir' }))) return true; await sbx().from('group_members').delete().eq('group_id', g.id).eq('user_id', FR.user.id); if (gActive === g.id) gActive = null; FR.renderTab(); return true; }
    case 'gfind': { const m = FR.fm[members[i]]; if (!m) { showToast('⚪ Sin posición ahora mismo'); return true; } FR.body.closest('.drawer').classList.add('hidden'); document.body.classList.remove('drawer-open'); map.flyTo(m.getLatLng(), 16); return true; }
    // Jam
    case 'jamsearch': { const q = v('jam-q'); if (!q) return true; if (!spOn()) throw new Error('Conecta Spotify en 🎵 Música para buscar canciones'); await search(q); $('jam-res').innerHTML = resHTML('jam'); return true; }
    case 'jamadd': applyJam(await rpc('jam_add', { p_group: gActive, p_track: lastRes[i] })); showToast('➕ Añadida a la jam'); return true;
    case 'jamtoggle': applyJam(await rpc('jam_toggle', { p_group: gActive, p_play: !jam.playing })); return true;
    case 'jamskip': if (jam && jam.current) applyJam(await rpc('jam_next', { p_group: gActive, p_expect: jam.current.uri })); return true;
    case 'jamsync': if (!spOn()) throw new Error('Conecta Spotify en 🎵 Música'); if (jam && jam.current) await applyJam(jam, true); return true;
  }
  return false;
};

window.FR_ON = (uid) => {
  if (uid === lastUid) return;
  lastUid = uid;
  if (!uid) { if (chan && FR.sb) FR.sb.removeChannel(chan); chan = null; groups = []; members = []; jam = null; FR.refreshIcons(); return; }
  syncClock(); loadGroups().catch(() => {});
};

$('music-btn').addEventListener('click', () => FR.openDrawer('music'));
$('nav-music').addEventListener('click', () => window.MUSIC.toggle());
spRedirectBack();
})();
