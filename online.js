// Online: login, guardados, comunidad y amigos en tiempo real (Supabase)
(() => {
const CFG = window.FUNRIDE_CONFIG || {};
const sb = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('TU-') && window.supabase
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
let busy = false, welcome = false, commSort = 'near';
let user = null, tab = 'saved', authMode = 'login', cache = {}, names = {}, chan = null;
let sharing = localStorage.getItem('funride_share') === '1';
const fm = {}, prof = {}, comm = L.layerGroup().addTo(map);
let draft = null;
const EMOJIS = ['🏍️','🛵','🚗','🏎️','🚙','🦊','🐺','🦅','🔥','⚡','🌵','🌊','👑','😎','🤘','🧭'];
const COLORS = ['#7c3aed','#ff3d71','#ff7a1a','#ffb800','#10b981','#06b6d4','#3b82f6','#64748b'];
const drawer = $('drawer'), body = $('drawer-body'), esc = escapeHtml;
const ES = { 'Invalid login credentials': 'Email o contraseña incorrectos', 'User already registered': 'Ese email ya está registrado', 'Email not confirmed': 'Confirma primero tu email' };
function avatarHTML(p, size = 40) {
  p = p || {};
  const bg = /^#[0-9a-f]{6}$/i.test(p.avatar_color || '') ? p.avatar_color : '#7c3aed';
  const img = /^data:image\/(jpeg|png|webp);base64,/.test(p.avatar_img || '') ? p.avatar_img : null;
  const inner = img ? `<img src="${img}" alt="">` : esc((p.avatar_emoji || (p.username || '?')[0] || '?').toString().slice(0, 4).toUpperCase());
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:${bg};font-size:${Math.round(size * 0.5)}px">${inner}</span>`;
}
window.myMapIcon = () => {
  const p = user && prof[user.id];
  return p && (p.avatar_img || p.avatar_emoji) ? L.divIcon({ className: '', html: `<div class="me-wrap">${avatarHTML(p, 42)}</div>`, iconSize: [42, 42] }) : null;
};
function refreshMyMarker() { if (userMarker) userMarker.setIcon(window.myMapIcon() || pinIcon('pin-me')); }
const friendIcon = (id) => L.divIcon({ className: '', html: `<div class="friend-wrap">${avatarHTML({ ...prof[id], username: names[id] || 'Amigo' }, 42)}</div>`, iconSize: [42, 42] });
const fail = (e) => { const m = (e && e.message) || String(e); if (/avatar|vehicle|"bio"|schema cache/.test(m)) return showToast('⚠️ Falta ejecutar schema_v2.sql en Supabase'); showToast('⚠️ ' + (ES[m] || (/at least 6/.test(m) ? 'La contraseña debe tener al menos 6 caracteres' : m))); };
const LIBERR = '<div class="empty"><b>No se pudo cargar la librería online</b><br>Comprueba tu conexión y recarga con Ctrl+F5.</div>';
const ATTR = '<p class="empty"><small>Mapa © colaboradores de OpenStreetMap · Rutas: OSRM · Búsqueda: Photon</small></p>';
const SETUP = `<div class="empty"><b>Online sin configurar</b><br><br>1. Crea un proyecto gratis en supabase.com<br>2. Ejecuta <code>schema.sql</code> en el SQL Editor<br>3. Pega la URL y la clave <i>anon</i> en <code>config.js</code></div>`;
const row = (t, s, btns, av = '') => `<div class="row">${av}<div class="row-txt"><b>${esc(t)}</b><small>${esc(s || '')}</small></div>${btns}</div>`;
const btn = (act, i, label) => `<button class="mini" data-act="${act}" data-i="${i}">${label}</button>`;
const simplify = (c, max = 500) => { const st = Math.ceil(c.length / max); return c.filter((_, i) => i % st === 0 || i === c.length - 1).map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]); };
const need = () => { if (!sb) { openDrawer('account'); return false; } if (!user) { showToast('🔐 Inicia sesión primero'); openDrawer('account'); return false; } return true; };

function openDrawer(t) {
  if (t) tab = t;
  drawer.classList.remove('hidden');
  document.body.classList.add('drawer-open');
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  renderTab();
}
const closeDrawer = () => { drawer.classList.add('hidden'); document.body.classList.remove('drawer-open'); };

async function renderTab() {
  if (tab === 'settings') { body.innerHTML = tplSettings(); return; }
  if (!sb) { body.innerHTML = CFG.SUPABASE_URL && !String(CFG.SUPABASE_URL).includes('TU-') && !window.supabase ? LIBERR : SETUP; return; }
  if (tab === 'account') { renderAccount(); body.insertAdjacentHTML('beforeend', ATTR); return; }
  if (!user) { body.innerHTML = '<p class="empty">Inicia sesión para usar esta sección.</p><button class="action-btn primary" data-act="goaccount">Entrar / Registrarme</button>'; return; }
  body.innerHTML = '<p class="empty"><span class="spin"></span>Cargando…</p>';
  try { body.innerHTML = await { saved: tplSaved, comm: tplComm, friends: tplFriends }[tab](); } catch (e) { body.innerHTML = `<p class="empty">⚠️ ${esc(e.message || e)}</p>`; }
}

function initDraft() {
  if (draft) return;
  const m = prof[user.id] || {};
  draft = { username: names[user.id] || '', vehicle: m.vehicle || '', bio: m.bio || '', avatar_emoji: m.avatar_emoji || '', avatar_color: m.avatar_color || '#7c3aed', avatar_img: m.avatar_img || null };
}
function syncDraft() {
  if (!draft || !$('pf-name')) return;
  draft.username = $('pf-name').value; draft.vehicle = $('pf-veh').value; draft.bio = $('pf-bio').value;
}
function renderAccount() {
  if (user) {
    initDraft();
    const d = draft;
    body.innerHTML = `<div class="pf-head">${avatarHTML(d, 80)}<div class="pf-id"><b>${esc(d.username || 'Piloto')}</b><small>${esc(user.email)}</small>
        <div class="pf-btns"><button class="mini" data-act="pickphoto">📷 Foto</button>${d.avatar_img ? '<button class="mini" data-act="rmphoto">Quitar foto</button>' : ''}</div></div></div>
      <div class="form">
        <label>Nombre de piloto</label><input id="pf-name" maxlength="20" value="${esc(d.username)}">
        <label>Mi moto / vehículo</label><input id="pf-veh" maxlength="30" placeholder="Ej: Yamaha MT-07" value="${esc(d.vehicle)}">
        <label>Sobre mí</label><input id="pf-bio" maxlength="80" placeholder="Ej: Curvas los domingos" value="${esc(d.bio)}">
        <label>Icono (si no usas foto)</label>
        <div class="swatches">${EMOJIS.map((e) => `<button class="sw ${d.avatar_emoji === e && !d.avatar_img ? 'on' : ''}" data-act="emoji" data-v="${e}">${e}</button>`).join('')}</div>
        <label>Color</label>
        <div class="swatches">${COLORS.map((c) => `<button class="sw dot ${d.avatar_color === c ? 'on' : ''}" style="background:${c}" data-act="color" data-v="${c}" aria-label="${c}"></button>`).join('')}</div>
        <button class="action-btn primary" data-act="saveprofile">💾 Guardar perfil</button>
      </div>
      <h4>Seguridad</h4>
      <div class="form inline"><input id="pf-pass" type="password" placeholder="Nueva contraseña" autocomplete="new-password"><button class="mini" data-act="chpass">Cambiar</button></div>
      <br><button class="action-btn" data-act="logout">Cerrar sesión</button>`;
    return;
  }
  const su = authMode === 'signup';
  body.innerHTML = `<div class="form"><h3>${su ? 'Crear cuenta' : 'Iniciar sesión'}</h3>
    ${su ? '<input id="au-name" placeholder="Nombre de piloto" maxlength="20">' : ''}
    <input id="au-email" type="email" placeholder="Email" autocomplete="email">
    <input id="au-pass" type="password" placeholder="Contraseña (mín. 6)" autocomplete="${su ? 'new-password' : 'current-password'}">
    <button class="action-btn primary" data-act="${su ? 'signup' : 'login'}">${su ? 'Registrarme' : 'Entrar'}</button>
    <button class="link" data-act="switch">${su ? 'Ya tengo cuenta' : 'Crear una cuenta nueva'}</button></div>`;
}

function tplStats() {
  let h = []; try { h = JSON.parse(localStorage.getItem('funride_trips') || '[]'); } catch {}
  const km = h.reduce((s, t) => s + t.km, 0), turns = h.reduce((s, t) => s + t.turns, 0), loops = h.filter((t) => t.loop).length;
  const pts = km + turns / 10, LV = [[0, 'Novato'], [50, 'Aprendiz'], [200, 'Piloto'], [500, 'Experto'], [1000, 'Maestro'], [2500, 'Leyenda']];
  let li = 0; LV.forEach((l, i) => { if (pts >= l[0]) li = i; });
  const next = LV[li + 1], pct = next ? Math.round(((pts - LV[li][0]) / (next[0] - LV[li][0])) * 100) : 100;
  const B = [['🥇', 'Primer viaje', h.length >= 1], ['🛣️', '10 viajes', h.length >= 10], ['📏', '100 km', km >= 100], ['🏔️', '500 km', km >= 500], ['🌀', '1000 curvas', turns >= 1000], ['🔄', 'Circuito', loops >= 1]];
  return `<h4>Tu nivel</h4><div class="lvl"><b>${LV[li][1]}</b><small>Nivel ${li + 1}${next ? ` · faltan ${Math.ceil(next[0] - pts)} pts para ${next[1]}` : ' · ¡máximo!'}</small><div class="fun-meter"><div class="fun-meter-fill" style="width:${pct}%"></div></div></div>
    <div class="stats3"><div><b>${km.toFixed(0)}</b><small>km</small></div><div><b>${h.length}</b><small>viajes</small></div><div><b>${turns}</b><small>curvas</small></div></div>
    <div class="badges">${B.map((b) => `<span class="badge ${b[2] ? 'on' : ''}" title="${b[1]}">${b[0]}<small>${b[1]}</small></span>`).join('')}</div>
    <p class="empty"><small>Los viajes se cuentan al llegar con la navegación de la app.</small></p>`;
}

function tplSettings() {
  const seg = (k, v, label, on) => `<button class="seg-b ${on ? 'on' : ''}" data-act="pref" data-k="${k}" data-v="${v}">${label}</button>`;
  const tog = (k, label, sub) => row(label, sub, `<button class="mini ${PREFS[k] ? 'on' : ''}" data-act="pref" data-k="${k}" data-v="toggle">${PREFS[k] ? 'Activado ✅' : 'Apagado'}</button>`);
  return tplStats() + `<h4>Cómo te mueves</h4><div class="seg">${seg('vehicle', 'bike', '🚴 Bici', PREFS.vehicle === 'bike')}${seg('vehicle', 'moto', '🏍️ Moto', PREFS.vehicle === 'moto')}${seg('vehicle', 'car', '🚗 Coche', PREFS.vehicle === 'car')}</div><h4>Mapa</h4><div class="seg">${seg('theme', 'light', '☀️ Claro', PREFS.theme === 'light')}${seg('theme', 'dark', '🌙 Oscuro', PREFS.theme === 'dark')}${seg('theme', 'auto', '🌗 Auto', PREFS.theme === 'auto')}</div>
    <h4>Color de la app</h4><div class="swatches">${ACCENTS.map((c, i) => `<button class="sw dot ${PREFS.accent === i ? 'on' : ''}" style="background:linear-gradient(135deg,${c[1]},${c[2]})" data-act="pref" data-k="accent" data-v="${i}" aria-label="${c[0]}" title="${c[0]}"></button>`).join('')}</div>
    <h4>Opciones</h4>${tog('poi', '🍽️ Locales en el mapa', 'Restaurantes, cafés y gasolineras al acercarte')}${tog('voice', '🔊 Voz en la navegación', 'Instrucciones habladas en español')}
    <p class="empty"><small>Estos ajustes se guardan en este dispositivo.</small></p>`;
}

const fileIn = document.createElement('input');
fileIn.type = 'file'; fileIn.accept = 'image/*';
function resizeImage(file, size = 128) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height), c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => rej(new Error('No se pudo leer la imagen'));
    img.src = URL.createObjectURL(file);
  });
}
fileIn.addEventListener('change', async () => {
  const f = fileIn.files[0]; fileIn.value = '';
  if (!f || !user) return;
  try { initDraft(); draft.avatar_img = await resizeImage(f); renderTab(); } catch (e) { fail(e); }
});

async function tplSaved() {
  const [p, r] = await Promise.all([
    sb.from('saved_places').select('*').order('created_at', { ascending: false }),
    sb.from('saved_routes').select('*').eq('user_id', user.id).order('created_at', { ascending: false })]);
  if (p.error) throw p.error; if (r.error) throw r.error;
  cache.places = p.data; cache.routes = r.data;
  const pl = p.data.map((x, i) => row('⭐ ' + x.name, x.addr, btn('goplace', i, 'Ir') + btn('delplace', i, '🗑'))).join('') || '<p class="empty">Aún no has guardado lugares. Pulsa ⭐ en un destino.</p>';
  const ro = r.data.map((x, i) => row((x.is_public ? '🌍 ' : '🔒 ') + x.name, `${(x.distance / 1000).toFixed(1)} km · ${x.turns} curvas`, btn('viewroute', i, 'Ver') + btn('pubroute', i, x.is_public ? 'Privar' : 'Publicar') + btn('delroute', i, '🗑'))).join('') || '<p class="empty">Aún no has guardado rutas. Pulsa 💾 en una ruta.</p>';
  return `<h4>Lugares</h4>${pl}<h4>Mis rutas</h4>${ro}`;
}

async function tplComm() {
  const { data, error } = await sb.from('saved_routes').select('*').eq('is_public', true).order('created_at', { ascending: false }).limit(80);
  if (error) throw error;
  const here = refPoint();
  const list = data.filter((r) => r.coords && r.coords.length).map((r) => ({ ...r, d: haversine(here, r.coords[0]), likes: 0, mine: false }));
  if (list.length) {
    const lk = await sb.from('route_likes').select('route_id,user_id').in('route_id', list.map((r) => r.id));
    if (!lk.error) (lk.data || []).forEach((l) => { const r = list.find((x) => x.id === l.route_id); if (r) { r.likes++; if (l.user_id === user.id) r.mine = true; } });
  }
  list.sort((a, b) => (commSort === 'top' ? b.likes - a.likes || a.d - b.d : a.d - b.d));
  cache.comm = list.slice(0, 25);
  const sb2 = (k, label) => `<button class="seg-b ${commSort === k ? 'on' : ''}" data-act="commsort" data-v="${k}">${label}</button>`;
  return `<div class="seg">${sb2('near', '📍 Cercanas')}${sb2('top', '❤️ Populares')}</div><h4>Rutas de la comunidad</h4>` +
    (cache.comm.map((x, i) => row(x.name, `por ${x.author || 'piloto'} · ${(x.distance / 1000).toFixed(1)} km · ${x.turns} curvas · a ${fmtDist(x.d)}`,
      btn('like', i, `${x.mine ? '❤️' : '🤍'} ${x.likes}`) + btn('viewcomm', i, 'Ver'))).join('') || '<p class="empty">Nadie ha publicado rutas todavía. ¡Sé el primero!</p>');
}

async function refreshNames() {
  const { data: fs } = await sb.from('friendships').select('*');
  cache.fs = fs || [];
  const ids = [...new Set(cache.fs.flatMap((f) => [f.requester, f.addressee]).concat(user.id))];
  let r = await sb.from('profiles').select('id,username,friend_code,avatar_img,avatar_emoji,avatar_color,bio,vehicle').in('id', ids);
  if (r.error) r = await sb.from('profiles').select('id,username,friend_code').in('id', ids);   // por si aún no ejecutaste schema_v2.sql
  (r.data || []).forEach((p) => { prof[p.id] = p; names[p.id] = p.username; if (p.id === user.id) cache.code = p.friend_code; });
  const pend = cache.fs.filter((f) => f.status === 'pending' && f.addressee === user.id).length;
  $('menu-btn').dataset.badge = pend || '';
  Object.keys(fm).forEach((id) => fm[id].setIcon(friendIcon(id)));
  refreshMyMarker();
  if (tab !== 'account' || drawer.classList.contains('hidden')) draft = null;   // recarga el borrador con los datos reales
}

async function tplFriends() {
  await refreshNames();
  const other = (f) => (f.requester === user.id ? f.addressee : f.requester);
  const inc = cache.fs.map((f, i) => ({ f, i })).filter((x) => x.f.status === 'pending' && x.f.addressee === user.id);
  const acc = cache.fs.map((f, i) => ({ f, i })).filter((x) => x.f.status === 'accepted');
  const out = cache.fs.filter((f) => f.status === 'pending' && f.requester === user.id);
  return `<div class="row"><div class="row-txt"><b>Tu código: ${esc(cache.code || '…')}</b><small>Compártelo para que te añadan</small></div>${btn('copycode', 0, '📋')}</div>
    <div class="form inline"><input id="fr-code" placeholder="Código de un amigo" maxlength="8">${btn('addfriend', 0, 'Añadir')}</div>
    <div class="row"><div class="row-txt"><b>📡 Compartir mi posición</b><small>Solo la ven tus amigos aceptados</small></div>${btn('toggleshare', 0, sharing ? 'Activado ✅' : 'Apagado')}</div>
    ${inc.length ? '<h4>Solicitudes</h4>' + inc.map((x) => row(names[other(x.f)] || 'Piloto', 'quiere ser tu amigo', btn('accept', x.i, '✔') + btn('unfriend', x.i, '✖'), avatarHTML(prof[other(x.f)], 44))).join('') : ''}
    <h4>Amigos</h4>${acc.map((x) => row(names[other(x.f)] || 'Piloto', `${(prof[other(x.f)] || {}).vehicle ? '🏍️ ' + prof[other(x.f)].vehicle + ' · ' : ''}${fm[other(x.f)] ? '🟢 en el mapa' : '⚪ sin posición'}`, btn('findfriend', x.i, '🎯') + btn('unfriend', x.i, '🗑'), avatarHTML(prof[other(x.f)], 44))).join('') || '<p class="empty">Añade amigos con su código.</p>'}
    ${out.length ? `<small class="empty">${out.length} solicitud(es) enviada(s) pendiente(s)</small>` : ''}`;
}

// ── Acciones ──
body.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (busy) return;
  busy = true; b.classList.add('loading');
  const a = b.dataset.act, i = +b.dataset.i, v = (id) => ($(id)?.value || '').trim();
  try {
    if (a === 'pref') { const k = b.dataset.k, val = b.dataset.v; PREFS[k] = val === 'toggle' ? !PREFS[k] : k === 'accent' ? +val : val; savePrefs(); applyPrefs(); if (k === 'vehicle') showToast('Se aplicará a las próximas rutas'); return renderTab(); }
    if (a === 'pickphoto') { syncDraft(); fileIn.click(); return; }
    if (a === 'rmphoto') { syncDraft(); draft.avatar_img = null; return renderTab(); }
    if (a === 'emoji') { syncDraft(); draft.avatar_emoji = b.dataset.v; draft.avatar_img = null; return renderTab(); }
    if (a === 'color') { syncDraft(); draft.avatar_color = b.dataset.v; return renderTab(); }
    if (a === 'saveprofile') {
      syncDraft();
      const name = draft.username.trim();
      if (name.length < 2) throw new Error('El nombre debe tener al menos 2 caracteres');
      const upd = { username: name, vehicle: draft.vehicle.trim() || null, bio: draft.bio.trim() || null, avatar_emoji: draft.avatar_emoji || null, avatar_color: draft.avatar_color, avatar_img: draft.avatar_img || null };
      const { error } = await sb.from('profiles').update(upd).eq('id', user.id);
      if (error) throw error;
      prof[user.id] = { ...prof[user.id], ...upd }; names[user.id] = name;
      refreshMyMarker(); draft = null; showToast('✅ Perfil guardado'); return renderTab();
    }
    if (a === 'chpass') {
      const pw = v('pf-pass');
      if (pw.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw error;
      $('pf-pass').value = ''; return showToast('🔑 Contraseña cambiada');
    }
    if (a === 'commsort') { commSort = b.dataset.v; return renderTab(); }
    if (a === 'like') {
      const r = cache.comm[i];
      if (r.mine) await sb.from('route_likes').delete().eq('route_id', r.id).eq('user_id', user.id);
      else { const { error } = await sb.from('route_likes').insert({ route_id: r.id }); if (error) throw new Error(/route_likes/.test(error.message) ? 'Falta ejecutar schema_v3.sql en Supabase' : error.message); }
      return renderTab();
    }
    if (a === 'goaccount') return openDrawer('account');
    if (a === 'switch') { authMode = authMode === 'login' ? 'signup' : 'login'; return renderTab(); }
    if (a === 'login') { welcome = true; const { error } = await sb.auth.signInWithPassword({ email: v('au-email'), password: v('au-pass') }); if (error) throw error; return; }
    if (a === 'signup') { welcome = true;
      const { data, error } = await sb.auth.signUp({ email: v('au-email'), password: v('au-pass'), options: { data: { username: v('au-name') }, emailRedirectTo: location.protocol.startsWith('http') ? location.origin + location.pathname : undefined } });
      if (error) throw error;
      if (!data.session) showToast('📧 Revisa tu email para confirmar la cuenta'); return;
    }
    if (a === 'logout') { draft = null; if (sharing) await sb.from('live_locations').delete().eq('user_id', user.id); return void (await sb.auth.signOut()); }
    if (a === 'goplace') { const p = cache.places[i]; closeDrawer(); if (inRoute) exitRouteMode(); return selectPlace({ name: p.name, addr: p.addr, lat: p.lat, lon: p.lon }); }
    if (a === 'delplace') { if (!(await dialog({ title: `¿Borrar «${cache.places[i].name}»?`, input: false, ok: 'Borrar' }))) return; await sb.from('saved_places').delete().eq('id', cache.places[i].id); return renderTab(); }
    if (a === 'viewroute' || a === 'viewcomm') return viewRoute(cache[a === 'viewroute' ? 'routes' : 'comm'][i]);
    if (a === 'pubroute') { const r = cache.routes[i]; await sb.from('saved_routes').update({ is_public: !r.is_public }).eq('id', r.id); return renderTab(); }
    if (a === 'delroute') { if (!(await dialog({ title: `¿Borrar «${cache.routes[i].name}»?`, input: false, ok: 'Borrar' }))) return; await sb.from('saved_routes').delete().eq('id', cache.routes[i].id); return renderTab(); }
    if (a === 'copycode') { await navigator.clipboard.writeText(cache.code); return showToast('✅ Código copiado'); }
    if (a === 'addfriend') {
      const code = v('fr-code').toLowerCase(); if (!code) return;
      const { data: p } = await sb.from('profiles').select('id,username').eq('friend_code', code).maybeSingle();
      if (!p) return showToast('😕 Ese código no existe');
      if (p.id === user.id) return showToast('😅 Ese es tu propio código');
      const { error } = await sb.from('friendships').insert({ addressee: p.id });
      if (error) throw new Error(error.code === '23505' ? 'Ya hay una solicitud con esa persona' : error.message);
      showToast('📨 Solicitud enviada a ' + p.username); return renderTab();
    }
    if (a === 'accept') { await sb.from('friendships').update({ status: 'accepted' }).eq('id', cache.fs[i].id); startLive(); return renderTab(); }
    if (a === 'unfriend') { if (!(await dialog({ title: '¿Quitar a este amigo / rechazar solicitud?', input: false, ok: 'Confirmar' }))) return; await sb.from('friendships').delete().eq('id', cache.fs[i].id); startLive(); return renderTab(); }
    if (a === 'findfriend') { const f = cache.fs[i], id = f.requester === user.id ? f.addressee : f.requester; if (!fm[id]) return showToast('⚪ Sin posición ahora mismo'); closeDrawer(); return map.flyTo(fm[id].getLatLng(), 16); }
    if (a === 'toggleshare') {
      sharing = !sharing; localStorage.setItem('funride_share', sharing ? '1' : '0');
      if (!sharing) await sb.from('live_locations').delete().eq('user_id', user.id); else postLocation();
      showToast(sharing ? '📡 Compartiendo tu posición con amigos' : '🔕 Posición oculta'); return renderTab();
    }
  } catch (err) { fail(err); } finally { busy = false; b.classList.remove('loading'); }
});

function viewRoute(r) {
  closeDrawer(); comm.clearLayers();
  if (inRoute) exitRouteMode();
  const line = L.polyline(r.coords, { color: '#7c3aed', weight: 6, lineCap: 'round' }).addTo(comm);
  L.polyline(r.coords, { color: '#fff', weight: 11, opacity: 0.9 }).addTo(comm).bringToBack();
  map.fitBounds(line.getBounds(), { padding: [60, 60] });
  if (r.dest_lat) selectPlace({ name: r.dest_name || r.name, addr: r.name, lat: r.dest_lat, lon: r.dest_lon }, false);
  showToast(`🗺️ ${r.name} · ${(r.distance / 1000).toFixed(1)} km · ${r.turns} curvas`);
}

async function savePlace() {
  if (!need() || !selectedPlace) return;
  const p = selectedPlace;
  const dup = await sb.from('saved_places').select('id').eq('lat', p.lat).eq('lon', p.lon).limit(1);
  if (dup.data && dup.data.length) return showToast('⭐ Ya lo tenías guardado');
  const { error } = await sb.from('saved_places').insert({ name: p.name, addr: p.addr || '', lat: p.lat, lon: p.lon });
  error ? fail(error) : showToast('⭐ Lugar guardado');
}

async function saveRoute() {
  if (!need() || !currentData) return;
  const r = currentData[currentMode];
  const d = await dialog({ title: '💾 Guardar ruta', value: `${destinationName} · ${modeLabel(currentMode)}`, checkLabel: '🌍 Compartir con la comunidad' });
  if (!d || !d.name) return;
  const name = d.name, pub = d.pub;
  const { error } = await sb.from('saved_routes').insert({
    name, author: names[user.id] || user.user_metadata?.username || 'piloto', dest_name: destinationName,
    dest_lat: destinationCoords[0], dest_lon: destinationCoords[1], mode: currentMode, coords: simplify(r.coords),
    distance: r.distance, duration: r.duration, turns: r.turns, is_public: pub });
  error ? fail(error) : showToast(pub ? '🌍 Ruta publicada' : '💾 Ruta guardada');
}

// ── Amigos en tiempo real ──
function upsertFriend(r) {
  if (r.user_id === user.id) return;
  const t = Date.parse(r.updated_at) || Date.now();
  if (Date.now() - t > 600000) return dropFriend(r.user_id);
  const ll = [r.lat, r.lon];
  if (!fm[r.user_id]) fm[r.user_id] = L.marker(ll, { icon: friendIcon(r.user_id), zIndexOffset: 900 }).addTo(map)
    .bindTooltip(names[r.user_id] || 'Amigo', { permanent: true, direction: 'bottom', offset: [0, 18], className: 'friend-label' });
  else fm[r.user_id].setLatLng(ll);
  fm[r.user_id]._t = t;
}
const dropFriend = (id) => { if (fm[id]) { map.removeLayer(fm[id]); delete fm[id]; } };
function stopLive() { if (chan) sb.removeChannel(chan); chan = null; Object.keys(fm).forEach(dropFriend); }
async function startLive() {
  stopLive(); await refreshNames();
  if (!drawer.classList.contains('hidden') && tab === 'account') renderAccount();
  const { data } = await sb.from('live_locations').select('*');
  (data || []).forEach(upsertFriend);
  chan = sb.channel('live').on('postgres_changes', { event: '*', schema: 'public', table: 'live_locations' },
    (pl) => (pl.eventType === 'DELETE' ? dropFriend(pl.old.user_id) : upsertFriend(pl.new)))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, async () => {
      await refreshNames();
      const { data } = await sb.from('live_locations').select('*');
      (data || []).forEach(upsertFriend);
      if (!drawer.classList.contains('hidden') && tab === 'friends') renderTab();
    }).subscribe();
}
async function postLocation() {
  if (sb && user && sharing && userLatLng) await sb.from('live_locations').upsert({ user_id: user.id, lat: userLatLng[0], lon: userLatLng[1], updated_at: new Date().toISOString() });
}
setInterval(postLocation, 8000);
setInterval(() => Object.keys(fm).forEach((id) => { if (Date.now() - fm[id]._t > 600000) dropFriend(id); }), 60000);
map.on('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('dialog').classList.contains('hidden')) { $('dlg-cancel').click(); e.stopImmediatePropagation(); return; }
  if (e.key === 'Escape' && !drawer.classList.contains('hidden')) { closeDrawer(); e.stopImmediatePropagation(); } }, true);

// ── Sesión ──
if (sb) {
  const apply = (session) => {
    const was = user; user = session?.user || null;
    $('menu-btn').classList.toggle('online', !!user);
    if (!user) { $('menu-btn').dataset.badge = ''; draft = null; }
    refreshMyMarker();
    if (user && !was) { if (welcome) { showToast('👋 Sesión iniciada'); welcome = false; } setTimeout(startLive, 0); }
    if (!user && was) stopLive();
    if (!drawer.classList.contains('hidden')) renderTab();
  };
  sb.auth.getSession().then(({ data }) => apply(data.session));
  sb.auth.onAuthStateChange((_e, s) => apply(s));
}

// ── Botones ──
$('menu-btn').addEventListener('click', () => (drawer.classList.contains('hidden') ? openDrawer() : closeDrawer()));
$('drawer-close').addEventListener('click', closeDrawer);
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.tab)));
$('fav-btn').addEventListener('click', savePlace);
$('save-route-btn').addEventListener('click', saveRoute);
$('route-btn').addEventListener('click', () => comm.clearLayers());
$('place-close').addEventListener('click', () => comm.clearLayers());

// ── Diálogo propio (sustituye a prompt/confirm, que fallan en apps instaladas) ──
function dialog({ title, value = '', checkLabel, input = true, ok = 'Guardar' }) {
  return new Promise((res) => {
    const d = $('dialog'), inp = $('dlg-input');
    $('dlg-title').textContent = title;
    inp.value = value; inp.classList.toggle('hidden', !input);
    $('dlg-check').checked = false;
    $('dlg-check-wrap').classList.toggle('hidden', !checkLabel);
    $('dlg-check-label').textContent = checkLabel || '';
    $('dlg-ok').textContent = ok;
    d.classList.remove('hidden');
    if (input) { inp.focus(); inp.select(); }
    const done = (v) => { d.classList.add('hidden'); $('dlg-ok').onclick = $('dlg-cancel').onclick = inp.onkeydown = null; res(v); };
    $('dlg-ok').onclick = () => done({ name: inp.value.trim(), pub: $('dlg-check').checked });
    $('dlg-cancel').onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') $('dlg-ok').click(); };
  });
}

// Enter envía formularios; deslizar hacia abajo cierra el menú
body.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id && e.target.id.startsWith('au-')) body.querySelector('[data-act="login"],[data-act="signup"]')?.click();
  if (e.target.id === 'fr-code') body.querySelector('[data-act="addfriend"]')?.click();
});
let swipeY = null;
const dhead = document.querySelector('.drawer-head');
dhead.addEventListener('touchstart', (e) => { swipeY = e.touches[0].clientY; }, { passive: true });
dhead.addEventListener('touchend', (e) => { if (swipeY !== null && e.changedTouches[0].clientY - swipeY > 60) closeDrawer(); swipeY = null; });
})();
