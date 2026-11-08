const API = location.hostname === 'localhost' ? '' : 'https://swook.onrender.com';
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const COLORS = { tapa: '#4A6984', papel: '#F5F0E3', agua: '#2F4A61', verde: '#557A92' };
const modeLabel = (book) => {
  if (book.modalidad === 'venta') return book.precio ? `$${Number(book.precio).toLocaleString('es-AR')}` : 'Venta';
  return { intercambio: 'Intercambio', gratis: 'Gratis' }[book.modalidad];
};
const DRAWN_COVERS = ['#4A6984', '#213242', '#6C8E7D', '#3A5568'];
const BOOK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5C10.3 5 8 4.3 3 4.3a1 1 0 0 0-1 1V18a1 1 0 0 0 1 1c4.6 0 6.8.6 8.5 2V6.9l.5-.4zm9-2.2c-5 0-7.3.7-9 2.2l.5.4V21c1.7-1.4 3.9-2 8.5-2a1 1 0 0 0 1-1V5.300a1 1 0 0 0-1-1z"/></svg>';

const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const plural = (n, one, many) => `${n.toLocaleString('es-AR')} ${n === 1 ? one : many}`;

function paintStyle(style) {
  style.layers = style.layers.filter((l) => !/building|poi|housenumber|aeroway|airport|shield/.test(l.id));
  for (const layer of style.layers) {
    const p = (layer.paint = layer.paint || {});
    const isWater = /water|ocean|river/.test(layer.id);
    if (layer.type === 'background') {
      p['background-color'] = COLORS.tapa;
    } else if (layer.type === 'fill') {
      p['fill-color'] = isWater ? COLORS.agua : COLORS.verde;
      p['fill-opacity'] = isWater ? 1 : 0.35;
      delete p['fill-outline-color'];
    } else if (layer.type === 'line') {
      const isBoundary = /boundary|admin/.test(layer.id);
      p['line-color'] = isWater ? COLORS.agua : COLORS.papel;
      p['line-opacity'] = isBoundary ? 0.25 : /motorway|trunk|primary/.test(layer.id) ? 0.42 : 0.2;
    } else if (layer.type === 'symbol') {
      p['text-color'] = COLORS.papel;
      p['text-halo-color'] = COLORS.tapa;
      p['text-halo-width'] = 1.4;
      p['text-opacity'] = 0.9;
    }
  }
  return style;
}

function boundsOf(zones) {
  const b = new maplibregl.LngLatBounds();
  zones.forEach((z) => b.extend([z.lng, z.lat]));
  return b;
}

const FIT = { padding: 70, maxZoom: 12 };

function coverColor(book) {
  const hash = [...book.titulo].reduce((a, c) => a + c.charCodeAt(0), 0);
  return DRAWN_COVERS[hash % DRAWN_COVERS.length];
}

function drawnCover(book) {
  const el = document.createElement('div');
  el.className = 'book-cover drawn';
  el.style.background = coverColor(book);
  el.textContent = book.titulo.slice(0, 44);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function bookItem(book) {
  const li = document.createElement('li');
  li.className = 'book';
  if (book.cover_url) {
    const img = document.createElement('img');
    img.className = 'book-cover';
    img.src = book.cover_url.startsWith('/') ? `${API}${book.cover_url}` : book.cover_url;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => img.replaceWith(drawnCover(book));
    li.append(img);
  } else {
    li.append(drawnCover(book));
  }
  const info = document.createElement('div');
  const lines = [['book-title', book.titulo], ['book-author', book.autor], ['book-mode', modeLabel(book)]];
  for (const [cls, text] of lines) {
    if (!text) continue;
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    info.append(el);
  }
  li.append(info);
  return li;
}

const NO_MAP_MESSAGE = 'Tu navegador no pudo abrir el mapa. Bajate la app para ver todos los libros.';
let map = null, activePin = null;

function closePanel() {
  $('panel').hidden = true;
  openZone = null;
  if (activePin) {
    activePin.setAttribute('aria-expanded', 'false');
    activePin.focus({ preventScroll: true });
    activePin = null;
  }
}

function openPanel(zone, pin) {
  openZone = zone;
  if (activePin) activePin.setAttribute('aria-expanded', 'false');
  activePin = pin;
  pin.setAttribute('aria-expanded', 'true');
  $('panel-title').textContent = zone.nombre;
  $('panel-count').textContent = plural(zone.count, 'libro publicado', 'libros publicados');
  $('panel').hidden = false;
  $('panel-close').focus({ preventScroll: true });
  showZoneBooks(zone);
  const mobile = innerWidth < 900;
  map.easeTo({
    center: [zone.lng, zone.lat],
    offset: mobile ? [0, -innerHeight * 0.2] : [-190, 0],
    duration: reduceMotion ? 0 : 500,
  });
}

function panelMessage(text, retryZone) {
  const li = document.createElement('li');
  li.className = 'panel-msg';
  li.textContent = text;
  if (retryZone) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'Volver a cargar';
    btn.addEventListener('click', () => showZoneBooks(retryZone));
    li.append(document.createElement('br'), btn);
  }
  $('panel-list').replaceChildren(li);
}

// Los libros de cada zona se piden la primera vez que se abre y quedan guardados.
async function showZoneBooks(zone) {
  $('panel-list').scrollTop = 0;
  if (zone.items) {
    $('panel-list').replaceChildren(...zone.items);
    return;
  }
  panelMessage('Cargando libros…');
  try {
    const res = await fetch(`${API}/public/zone?lat=${zone.lat}&lng=${zone.lng}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(res.status);
    // Se guardan los elementos ya armados, con sus imágenes cargadas: al volver a la
    // zona se reusan tal cual y ninguna tapa se descarga de nuevo, venga de donde venga.
    zone.items = (await res.json()).books.map(bookItem);
    if (openZone === zone) $('panel-list').replaceChildren(...zone.items);
  } catch {
    if (openZone === zone) panelMessage('No pudimos cargar los libros de esta zona.', zone);
  }
}

const GROUP_PX = 56;
let allZones = [], markers = [], pinsShown = false, openZone = null;

// Une zonas que en pantalla quedarían encimadas. Se recalcula con cada zoom.
function groupZones() {
  const groups = [];
  for (const zone of allZones) {
    const pt = map.project([zone.lng, zone.lat]);
    const near = groups.find((g) => Math.hypot(g.x - pt.x, g.y - pt.y) < GROUP_PX);
    if (near) {
      near.zones.push(zone);
      near.count += zone.count;
    } else {
      groups.push({ x: pt.x, y: pt.y, zones: [zone], count: zone.count });
    }
  }
  return groups;
}

function makePin(group, i, drop) {
  const pin = document.createElement('button');
  const zone = group.zones[0];
  const isGroup = group.zones.length > 1;
  pin.type = 'button';
  pin.className = `pin${isGroup ? ' group' : ''}${drop ? ' drop' : ''}`;
  pin.style.setProperty('--d', `${Math.min(i * 55, 900)}ms`);
  pin.innerHTML = `<span class="pin-inner">${BOOK_ICON}<span class="pin-count"></span></span>`;
  pin.querySelector('.pin-count').textContent = group.count;
  new maplibregl.Marker({ element: pin, anchor: 'center' }).setLngLat([zone.lng, zone.lat]).addTo(map);
  // Marker pisa aria-label al agregarse: se define después.
  if (isGroup) {
    pin.setAttribute('aria-label', `${plural(group.count, 'libro', 'libros')} en ${plural(group.zones.length, 'zona', 'zonas')} cercanas. Acercar`);
    pin.addEventListener('click', () => {
      map.fitBounds(boundsOf(group.zones), { padding: 90, maxZoom: 13, duration: reduceMotion ? 0 : 600 });
    });
  } else {
    pin.setAttribute('aria-label', `${zone.nombre}: ${plural(zone.count, 'libro', 'libros')}`);
    pin.setAttribute('aria-expanded', String(openZone === zone));
    if (openZone === zone) activePin = pin;
    pin.addEventListener('click', () => openPanel(zone, pin));
  }
  return pin;
}

function renderPins(drop = false) {
  markers.forEach((pin) => pin.closest('.maplibregl-marker')?.remove());
  markers = groupZones().map((group, i) => makePin(group, i, drop));
}

function addPins(zones) {
  allZones = zones;
  pinsShown = true;
  renderPins(true);
  map.on('zoomend', () => renderPins());
}

function showStatus(message, retry) {
  const box = $('map-status');
  box.hidden = false;
  box.textContent = message;
  if (retry) {
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = 'Volver a cargar';
    btn.addEventListener('click', loadBooks);
    box.append(document.createElement('br'), btn);
  }
}

async function loadBooks() {
  showStatus('Buscando libros…');
  try {
    const res = await fetch(`${API}/public/map`, { signal: AbortSignal.timeout(70000) });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (!map) {
      showStatus(NO_MAP_MESSAGE);
      return;
    }
    if (!data.zones.length) {
      showStatus('Todavía no hay libros en el mapa. Bajate la app y publicá el primero.');
      return;
    }
    $('map-status').hidden = true;
    // Cuenta solo lo que se ve en el mapa: total y zonas salen de la misma respuesta.
    // Encuadra exactamente las zonas con libros: un solo barrio o todo el país.
    map.fitBounds(boundsOf(data.zones), { ...FIT, duration: 0 });
    addPinsWhenVisible(data.zones);
    $('map-all').hidden = false;
    $('map-all').onclick = () => map.fitBounds(boundsOf(data.zones), { ...FIT, duration: reduceMotion ? 0 : 700 });
  } catch {
    showStatus('No pudimos cargar los libros del mapa. Revisá tu conexión y volvé a cargar.', true);
  }
}

// Los libros caen sobre el mapa cuando la persona llega hasta ahí.
function addPinsWhenVisible(zones) {
  const seen = new IntersectionObserver((entries, obs) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    obs.disconnect();
    addPins(zones);
  }, { threshold: 0.35 });
  seen.observe($('map'));
}

async function initMap() {
  try {
    const style = paintStyle(await (await fetch(STYLE_URL)).json());
    map = new maplibregl.Map({
      container: 'map',
      style,
      center: [-58.44, -34.6],
      zoom: 10.5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: true,
      locale: {
        'CooperativeGesturesHandler.WindowsHelpText': 'Usá Ctrl + scroll para acercar el mapa',
        'CooperativeGesturesHandler.MacHelpText': 'Usá ⌘ + scroll para acercar el mapa',
        'CooperativeGesturesHandler.MobileHelpText': 'Usá dos dedos para mover el mapa',
      },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  } catch {
    map = null;
  }
  loadBooks();
}

$('panel-close').addEventListener('click', closePanel);
// En el panel, el botón de descarga va directo a la tienda que corresponde.
const PLATFORM = (() => {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  // iPadOS se presenta como Mac: se reconoce por la pantalla táctil.
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return 'desktop';
})();
// El paso 1 se adapta al dispositivo. En computadora queda el texto genérico del HTML.
const STEP_DOWNLOAD = {
  ios: 'Descargala gratis desde el App Store.',
  android: 'Muy pronto vas a poder descargarla gratis desde Google Play. Anotate y te avisamos.',
};
if (STEP_DOWNLOAD[PLATFORM]) $('step-download').textContent = STEP_DOWNLOAD[PLATFORM];

if (PLATFORM === 'ios') {
  $('panel-download').href = 'https://apps.apple.com/app/id6793781403';
} else if (PLATFORM === 'android') {
  $('panel-download').addEventListener('click', (e) => {
    e.preventDefault();
    $('android-dialog').querySelector('.feedback').textContent = '';
    $('android-dialog').showModal();
  });
} else {
  // Computadora: baja a la sección de descarga y cierra el panel.
  $('panel-download').addEventListener('click', () => { $('panel').hidden = true; });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('panel').hidden) closePanel(); });
const isbnBtn = $('isbn-btn'), isbnInfo = $('isbn-info');
const toggleIsbn = (open) => {
  isbnInfo.hidden = !open;
  isbnBtn.setAttribute('aria-expanded', String(open));
};
isbnBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleIsbn(isbnInfo.hidden); });
document.addEventListener('click', (e) => { if (!isbnInfo.contains(e.target)) toggleIsbn(false); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !isbnInfo.hidden) { toggleIsbn(false); isbnBtn.focus(); }
});
initMap();

// ── Métricas: consulta mientras la sección está a la vista ──
const STATS_INTERVAL_MS = 20000;
const shownStats = {};
let statsVisible = false, statsTimer = null;

function animateStat(el, key, value) {
  const from = shownStats[key] || 0;
  shownStats[key] = value;
  if (from === value) return;
  if (reduceMotion) {
    el.textContent = value.toLocaleString('es-AR');
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / 900, 1);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = Math.round(from + (value - from) * eased).toLocaleString('es-AR');
    if (t < 1 && shownStats[key] === value) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let lastStats = null;

// Muestra los últimos datos conocidos. El contador solo anima si la sección está a la vista.
function renderStats(data) {
  document.querySelectorAll('[data-stat]').forEach((item) => {
    const value = data[item.dataset.stat] || 0;
    item.hidden = value === 0;
    if (statsVisible && !item.hidden) animateStat(item.querySelector('dd'), item.dataset.stat, value);
  });
  $('stats').classList.remove('pending');
  $('stats').removeAttribute('aria-busy');
}

async function refreshStats() {
  try {
    const res = await fetch(`${API}/public/stats`);
    if (!res.ok) return;
    lastStats = await res.json();
    renderStats(lastStats);
  } catch {
    // Sin datos la sección sigue como estaba: nunca se muestran números inventados.
  }
}

function syncStatsPolling() {
  clearInterval(statsTimer);
  if (statsVisible && !document.hidden) {
    refreshStats();
    statsTimer = setInterval(refreshStats, STATS_INTERVAL_MS);
  }
}

new IntersectionObserver((entries) => {
  statsVisible = entries[0].isIntersecting;
  // Al entrar en pantalla, el contador arranca ya con los datos que se cargaron antes.
  if (statsVisible && lastStats) renderStats(lastStats);
  syncStatsPolling();
}, { threshold: 0.3 }).observe($('stats'));
document.addEventListener('visibilitychange', syncStatsPolling);
refreshStats();

const androidDialog = $('android-dialog');
document.querySelectorAll('[data-open-android]').forEach((btn) => {
  btn.addEventListener('click', () => {
    androidDialog.querySelector('.feedback').textContent = '';
    androidDialog.showModal();
  });
});
androidDialog.querySelector('.dialog-close').addEventListener('click', () => androidDialog.close());
// Click en el fondo oscuro cierra el modal.
androidDialog.addEventListener('click', (e) => {
  if (e.target !== androidDialog) return;
  const r = androidDialog.getBoundingClientRect();
  const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  if (outside) androidDialog.close();
});

document.querySelectorAll('.android-form').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    const btn = form.querySelector('button');
    const fb = form.querySelector('.feedback');
    btn.disabled = true;
    btn.textContent = 'Anotando…';
    fb.textContent = '';
    try {
      const res = await fetch(`${API}/waitlist/android`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.value.trim() }),
      });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      fb.textContent = data.status === 'already_registered'
        ? 'Ya estás anotado. Te avisamos cuando salga.'
        : 'Listo, te avisamos cuando Swook llegue a Android.';
      input.value = '';
    } catch {
      fb.textContent = 'No pudimos anotarte. Revisá el mail y probá de nuevo.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Anotarme';
    }
  });
});

// ── Salto entre pantallas (solo escritorio) ──────────────────
// Al dejar de scrollear: si la sección siguiente (o la anterior, al subir) ya ocupa
// al menos el 25% de la pantalla, se completa el desplazamiento hasta ella; si no,
// se vuelve a la sección actual. Usa la misma condición que el CSS de tres pantallas.
const SNAP_MEDIA = matchMedia('(min-width: 900px) and (min-height: 620px)');
const SNAP_SECTIONS = ['.hero', '.explore', '.closing'].map((sel) => document.querySelector(sel));
const SNAP_THRESHOLD = 0.25;
const SNAP_IDLE_MS = 120;
const SNAP_DURATION_MS = 420;
let lastScrollY = scrollY, scrollDir = 0, snapIdle = null, snapAnim = null;

function cancelSnap() {
  if (snapAnim) cancelAnimationFrame(snapAnim);
  snapAnim = null;
}

function animateScrollTo(target) {
  cancelSnap();
  const start = scrollY, delta = target - start;
  if (Math.abs(delta) < 2) return;
  if (reduceMotion) { scrollTo({ top: target, behavior: 'instant' }); return; }
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min((now - t0) / SNAP_DURATION_MS, 1);
    scrollTo({ top: start + delta * (1 - (1 - t) ** 3), behavior: 'instant' });
    snapAnim = t < 1 ? requestAnimationFrame(step) : null;
  };
  snapAnim = requestAnimationFrame(step);
}

function snapToSection() {
  if (!SNAP_MEDIA.matches || document.querySelector('dialog[open]')) return;
  const vh = innerHeight, y = scrollY;
  const tops = SNAP_SECTIONS.map((sec) => sec.getBoundingClientRect().top + y);
  let i = 0;
  while (i + 1 < tops.length && tops[i + 1] <= y + 1) i += 1;
  const next = tops[i + 1];
  if (next === undefined || Math.abs(tops[i] - y) < 2) return;
  const nextShare = (y + vh - next) / vh; // parte de la pantalla que ocupa la sección siguiente
  if (nextShare <= 0) return; // dentro de una sección más alta que la pantalla: scroll libre
  const goNext = scrollDir >= 0 ? nextShare >= SNAP_THRESHOLD : 1 - nextShare < SNAP_THRESHOLD;
  animateScrollTo(goNext ? next : tops[i]);
}

addEventListener('scroll', () => {
  // Durante la animación solo se registra la posición, para que el próximo gesto
  // se compare con donde quedó la página y no con donde estaba antes del salto.
  if (snapAnim) { lastScrollY = scrollY; return; }
  if (scrollY !== lastScrollY) scrollDir = scrollY > lastScrollY ? 1 : -1;
  lastScrollY = scrollY;
  clearTimeout(snapIdle);
  snapIdle = setTimeout(snapToSection, SNAP_IDLE_MS);
}, { passive: true });
// Cualquier gesto de la persona durante la animación la interrumpe.
['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((type) => addEventListener(type, cancelSnap, { passive: true }));
