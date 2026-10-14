/* Find toilet – ingen sporing, ingen konti. Positionen forlader aldrig telefonen,
   undtagen hvis brugeren selv slår "Tegn ruten ad gaderne" til (så sendes start og mål til en rute-tjeneste). */
(function () {
  'use strict';
  const DATA = window.TOILET_DATA;
  const WALK_M_PER_MIN = 67;   // ca. 4 km/t – roligt tempo
  const DETOUR = 1.3;          // fugleflugt -> gåafstand (skøn)
  const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
  const CENTER = [55.6761, 12.5683];
  const $ = id => document.getElementById(id);
  const S = { me: null, filters: new Set(), selected: null, nav: null, heading: null, routeOK: false, firstFix: true, watch: null };
  const F = DATA.features.map(f => ({ id: f.properties.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], p: f.properties }));
  const byId = new Map(F.map(t => [t.id, t]));

  /* ---------- Geometri ---------- */
  const rad = d => d * Math.PI / 180;
  function dist(a, b) {
    const R = 6371000, dLa = rad(b.lat - a.lat), dLo = rad(b.lon - a.lon);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const fmtDist = m => m < 1000 ? (Math.max(10, Math.round(m / 10) * 10)) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km';
  const walkMin = (m, isRoute) => Math.max(1, Math.round((isRoute ? m : m * DETOUR) / WALK_M_PER_MIN));
  const fmtWalk = (m, isRoute) => { const n = walkMin(m, isRoute); return n < 60 ? `ca. ${n} min. gang` : `ca. ${Math.floor(n / 60)} t. ${n % 60} min. gang`; };
  const DIRS = ['nord', 'nordøst', 'øst', 'sydøst', 'syd', 'sydvest', 'vest', 'nordvest'];
  const dirName = b => DIRS[Math.round(b / 45) % 8];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Data-hjælpere ---------- */
  const st = t => Hours.openState(t.p, new Date());
  function passes(t) {
    const f = S.filters;
    if (f.has('free') && t.p.fee !== false) return false;
    if (f.has('wheelchair') && t.p.wheelchair !== true) return false;
    if (f.has('changing') && t.p.changing_table !== true) return false;
    if (f.has('open') && st(t).state !== 'open') return false;
    return true;
  }
  const visible = () => F.filter(passes);
  function nearest(lat, lon, n) {
    const me = { lat, lon };
    return visible().map(t => ({ t, d: dist(me, t) })).sort((a, b) => a.d - b.d).slice(0, n || 5);
  }
  function title(t) {
    const p = t.p; let n = p.name && p.name !== 'Toilet' ? p.name : 'Offentligt toilet';
    if (/^(toilet|offentligt toilet|pissoir)$/i.test(n) && p.address) n = (p.name || 'Toilet') + ', ' + p.address.split(',')[0];
    return n;
  }
  const SV = {
    wheel: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4" r="1.8"/><path d="M11 7v6h6l2 5"/><path d="M8.5 10.5a5.5 5.5 0 1 0 7 7"/></svg>',
    coin: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2a3 3 0 0 0-2.5-1.2c-1.7 0-2.8.9-2.8 2s1 1.6 2.8 2 2.8 1 2.8 2.1-1.2 2-2.8 2a3 3 0 0 1-2.6-1.3M12 6.5v1.5M12 16v1.5"/></svg>',
    baby: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7" r="2.5"/><path d="M4 20c0-4 2-7 5-7s5 3 5 7M15 11h5v9"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    nav: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 21 3l-8 18-2-8z"/></svg>',
    wc: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4.5" r="1.8"/><path d="M10 8h4l1 6h-2l-1 7M11 21l-1-7h-2"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'
  };
  /* Handicapadgang: Ja / Nej / Ukendt. Kommunernes "nej" betyder ofte bare "ikke registreret" → forsigtig tekst. */
  function access(p) {
    const muni = p.source.includes('kk') || p.source.includes('frb');
    const w = p.wheelchair === true ? { k: 'yes', t: 'Handicapvenligt', s: 'Handicapvenligt' }
      : p.wheelchair === false ? (muni ? { k: 'no', t: 'Ikke angivet som handicapvenligt', s: 'Ikke angivet' } : { k: 'no', t: 'Ikke handicapvenligt (ifølge OpenStreetMap)', s: 'Ikke handicapvenligt' })
      : { k: 'unknown', t: 'Handicapadgang ukendt', s: 'Adgang ukendt' };
    const f = p.fee === false ? { k: 'yes', t: 'Gratis' } : p.fee === true ? { k: 'pay', t: 'Betaling' } : { k: 'unknown', t: 'Pris ukendt' };
    return { w, f, baby: p.changing_table === true };
  }
  function badges(t, mini) {
    const p = t.p, a = access(p), b = [];
    b.push(`<span class="badge w-${a.w.k}" data-b="wheel">${SV.wheel}${esc(mini ? a.w.s : a.w.t)}</span>`);
    b.push(`<span class="badge f-${a.f.k}" data-b="fee">${SV.coin}${esc(a.f.t)}</span>`);
    if (a.baby) b.push(`<span class="badge" data-b="baby">${SV.baby}Puslebord</span>`);
    if (!mini && p.staffed) b.push(`<span class="badge">${SV.user}Med personale</span>`);
    if (!mini && p.type === 'Pissoir') b.push('<span class="badge">Kun pissoir</span>');
    return `<div class="badges${mini ? ' mini' : ''}">${b.join('')}</div>`;
  }
  function openLine(t) { const s = st(t); return `<span class="os ${s.state}"><i></i>${esc(s.text)}</span>`; }
  const SRC = { kk: 'Københavns Kommune', frb: 'Frederiksberg Kommune', osm: 'OpenStreetMap' };
  const gmaps = t => `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lon}&travelmode=walking`;
  const amaps = t => `https://maps.apple.com/?daddr=${t.lat},${t.lon}&dirflg=w`;

  /* ---------- Kort ---------- */
  // Bundarket dækker den nederste del af kortet på mobil → hold punkter i den synlige del
  const wide = () => window.innerWidth >= 900;
  const fitPad = () => wide() ? { paddingTopLeft: [460, 40], paddingBottomRight: [40, 40] } : { paddingTopLeft: [24, 140], paddingBottomRight: [24, ($('panel').offsetHeight || 0) + 24] };
  function centerVisible(ll, z) { map.setView(ll, z, { animate: false }); if (!wide()) map.panBy([0, Math.round((($('panel').offsetHeight || 0) - 120) / 2)], { animate: false }); else map.panBy([-220, 0], { animate: false }); }
  const map = L.map('map', { zoomControl: true, tap: true }).setView(CENTER, 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Data: Kbh. Kommune, Frb. Kommune, OSM'
  }).addTo(map);
  const cluster = L.markerClusterGroup({ disableClusteringAtZoom: 16, maxClusterRadius: 45, showCoverageOnHover: false });
  map.addLayer(cluster);
  const markers = new Map();
  function icon(t) {
    const s = st(t).state, sel = S.selected === t.id ? ' sel' : '';
    return L.divIcon({ className: `wc-icon ${s}${sel}`, html: SV.wc, iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -14] });
  }
  function popupHtml(t) {
    const d = S.me ? ` · ${fmtDist(dist(S.me, t))}` : '';
    return `<h3>${esc(title(t))}</h3><div>${openLine(t)}${d}</div><div class="small">Se mere nedenfor</div>`;
  }
  function cardHtml(t, d, label) {
    const p = t.p, far = d != null && d > 15000;
    const s = st(t);
    return `<article class="card" data-id="${t.id}" aria-label="${esc(label + ': ' + title(t))}">
      <div class="label">${label}</div>
      <h3 class="name">${esc(title(t))}</h3>
      <div class="sub">${esc(p.address || 'Ingen adresse')}${d != null ? ` · <b class="dist">${fmtDist(d)} · ${fmtWalk(d)}</b>` : ''}</div>
      ${badges(t)}
      <div class="info-row">${SV.clock}<div><div class="os-big ${s.state}">${s.state === 'open' ? 'Åbent nu' : s.state === 'closed' ? 'Lukket nu' : 'Åbningstid'}</div><div class="small">${esc(p.hours_text || s.text)}${p.season === 'vinterlukket' ? ' · lukket om vinteren' : ''}</div></div></div>
      ${p.note ? `<div class="small note">${esc(p.note)}</div>` : ''}
      ${far ? '<div class="empty">Du er langt fra København og Frederiksberg. Appen har kun toiletter derfra.</div>' : ''}
      <button class="btn-big primary" data-nav="${t.id}">${SV.nav}Vis vej${d != null ? ` · ${walkMin(d)} min` : ''}</button>
      ${window.Reviews ? Reviews.blockHtml(t.id) : ''}
      <div class="small src">Kilde: ${p.source.map(s => SRC[s]).join(' + ')}</div></article>`;
  }
  function drawMarkers() {
    cluster.clearLayers(); markers.clear();
    const list = visible().map(t => {
      const m = L.marker([t.lat, t.lon], { icon: icon(t), title: title(t), keyboard: true });
      m.on('click', () => pick(t.id));
      markers.set(t.id, m); return m;
    });
    cluster.addLayers(list);
  }
  function select(id, openPopup) {
    const prev = S.selected; S.selected = id;
    [prev, id].forEach(x => { const m = markers.get(x); if (m) m.setIcon(icon(byId.get(x))); });
    if (openPopup) {
      // Selvstændig popup (ikke bundet til markøren), så klyngerne ikke lukker den, når kortet flytter sig
      const t = byId.get(id);
      centerVisible([t.lat, t.lon], Math.max(map.getZoom(), 16));
      L.popup({ maxWidth: 300, autoPanPadding: [10, 10], offset: [0, -14] }).setLatLng([t.lat, t.lon]).setContent(popupHtml(t)).openOn(map);
    }
  }
  function pick(id) {
    S.pick = id; select(id, true);
    if (S.nav) return;
    if (!S.me) { show('viewNear'); $('gpsStatus').textContent = ''; $('nearestCard').innerHTML = cardHtml(byId.get(id), null, 'Valgt toilet'); fillRv(id); $('othersList').innerHTML = ''; $('othersTitle').hidden = true; }
    else showNear();
    $('panel').scrollTop = 0;
  }
  map.getContainer().addEventListener('click', e => {
    const b = e.target.closest('[data-nav]'); if (b) { e.stopPropagation(); startNav(+b.dataset.nav); }
  }, true); // capture: Leaflet stopper klik inde i popups

  /* ---------- Min position ---------- */
  let meMarker = null, accCircle = null;
  function setMe(lat, lon, acc, src) {
    S.me = { lat, lon, acc: acc || 0, src };
    if (!meMarker) {
      meMarker = L.marker([lat, lon], { icon: L.divIcon({ className: 'me-dot', iconSize: [22, 22] }), zIndexOffset: 1000, interactive: false }).addTo(map);
      accCircle = L.circle([lat, lon], { radius: acc || 0, color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
    } else { meMarker.setLatLng([lat, lon]); accCircle.setLatLng([lat, lon]).setRadius(acc || 0); }
    if (S.nav) updateNav(); else showNear();
    if (S.firstFix && !S.nav) {
      S.firstFix = false;
      const n = nearest(lat, lon, 1)[0];
      if (n && n.d < 5000) map.fitBounds(L.latLngBounds([[lat, lon], [n.t.lat, n.t.lon]]).pad(0.3), Object.assign({ maxZoom: 17 }, fitPad()));
      else centerVisible([lat, lon], 15);
    }
  }
  function startGPS() {
    if (!('geolocation' in navigator)) { gpsFail('Din telefon eller browser kan ikke finde din placering.'); return; }
    show('viewNear'); $('btnLocate').hidden = false; $('gpsStatus').textContent = 'Finder din position …';
    $('nearestCard').innerHTML = '<div class="empty">Vent et øjeblik – vi finder, hvor du er.</div>';
    if (S.watch !== null) navigator.geolocation.clearWatch(S.watch);
    S.watch = navigator.geolocation.watchPosition(
      pos => { hint(null); setMe(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, 'gps');
        if (pos.coords.heading != null && !isNaN(pos.coords.heading) && S.headingSrc !== 'compass') { S.heading = pos.coords.heading; S.headingSrc = 'gps'; } },
      err => gpsFail(err.code === 1 ? 'Du har ikke givet lov til at bruge din placering.' : 'Din placering kunne ikke findes lige nu.', err.code),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function gpsFail(msg, code) {
    if (S.me && S.me.src === 'gps') { $('gpsStatus').textContent = 'GPS-signalet er svagt – viser seneste position.'; return; }
    show('viewNear'); tapMode('Tryk på kortet, der hvor du står.');
    if (S.me) return; // har allerede valgt på kortet
    document.querySelector('.filters').hidden = true; $('gpsStatus').textContent = '';
    $('nearestCard').innerHTML = `<div class="card off-card" id="locOff">
      <div class="label">Placering er slået fra</div>
      <p class="off-text">${esc(msg)} Appen kan derfor ikke se, hvor du er.</p>
      <button class="btn-big primary" data-help="1">Hjælp: slå placering til</button>
      <button class="btn-big secondary" data-retry="1">Prøv igen</button>
      <p class="small">Eller tryk på kortet, der hvor du står.</p></div>`;
  }
  function retryGPS() { S.tap = false; hint(null); startGPS(); }
  function tapMode(msg) {
    S.tap = true; show('viewNear');
    hint(msg || 'Tryk på kortet, der hvor du står.');
    $('gpsStatus').textContent = 'Tryk på kortet for at vælge, hvor du er.';
    if (!S.me) { $('nearestCard').innerHTML = '<div class="empty">Tryk på kortet, der hvor du står. Så viser vi de nærmeste toiletter.</div>'; $('othersTitle').hidden = true; $('othersList').innerHTML = ''; }
  }
  map.on('click', e => {
    if (S.tap || !S.me || S.me.src === 'tap') { S.tap = false; hint(null); S.firstFix = !S.me; setMe(e.latlng.lat, e.latlng.lng, 0, 'tap'); }
  });
  function hint(t) { const h = $('mapHint'); h.hidden = !t; h.textContent = t || ''; }

  /* ---------- Visninger ---------- */
  function show(v) { ['viewStart', 'viewNear', 'viewNav'].forEach(x => $(x).hidden = x !== v); }
  function showNear() {
    if (S.nav || !S.me) return;
    show('viewNear'); document.querySelector('.filters').hidden = false;
    $('gpsStatus').innerHTML = S.me.src === 'gps'
      ? `<span class="dotlive"></span>Din position er fundet${S.me.acc ? ` (± ${Math.round(S.me.acc)} m)` : ''}`
      : 'Du har valgt din position på kortet. Tryk igen for at flytte den.';
    const list = nearest(S.me.lat, S.me.lon, 5);
    if (!list.length) {
      $('nearestCard').innerHTML = '<div class="empty">Ingen toiletter passer til dine valg. Prøv at slå et filter fra.</div>';
      $('othersList').innerHTML = ''; $('othersTitle').hidden = true; return;
    }
    const [b, ...rest] = list;
    const pk = S.pick && byId.get(S.pick);
    $('nearestCard').innerHTML = pk
      ? `<button class="back-link" data-unpick="1">${SV.back}Vis nærmeste toilet igen</button>` + cardHtml(pk, dist(S.me, pk), 'Valgt toilet')
      : cardHtml(b.t, b.d, 'Nærmeste toilet');
    fillRv((pk || b.t).id);
    // Er det nærmeste lukket/ukendt? Så foreslå også det nærmeste, der er åbent nu
    if (!pk && st(b.t).state !== 'open') {
      const o = visible().filter(t => st(t).state === 'open').map(t => ({ t, d: dist(S.me, t) })).sort((x, y) => x.d - y.d)[0];
      if (o && o.d < 5000) $('nearestCard').insertAdjacentHTML('beforeend', `<button class="open-alt" data-show="${o.t.id}"><span class="os open"><i></i>Åbent nu</span><b>${esc(title(o.t))}</b><span class="small">${fmtDist(o.d)} · ${fmtWalk(o.d)}</span>${SV.chev}</button>`);
    }
    $('othersTitle').hidden = !rest.length;
    const li = x => `<li><button data-show="${x.t.id}"><span class="o-ico">${SV.wc}</span><span class="o-main"><span class="o-name">${esc(title(x.t))}</span>
      <span class="o-meta">${openLine(x.t)}<span class="mini-slot" data-mini="${x.t.id}">${window.Reviews ? Reviews.miniHtml(x.t.id) : ''}</span></span>${badges(x.t, true)}</span><span class="o-dist">${fmtDist(x.d)}<small>${walkMin(x.d)} min</small></span></button></li>`;
    $('othersList').innerHTML = rest.map(li).join('');
    if (window.Reviews && Reviews.enabled) Reviews.loadSummary(rest.map(x => x.t.id)).then(() => document.querySelectorAll('[data-mini]').forEach(el => { el.innerHTML = Reviews.miniHtml(+el.dataset.mini); }));
    if (!S.pick && S.selected !== b.t.id) select(b.t.id, false);
  }
  $('panel').addEventListener('click', e => {
    const n = e.target.closest('[data-nav]'); if (n) return startNav(+n.dataset.nav);
    const s = e.target.closest('[data-show]'); if (s) return pick(+s.dataset.show);
    if (e.target.closest('[data-help]')) return helpDialog();
    if (e.target.closest('[data-retry]')) return retryGPS();
    if (e.target.closest('[data-unpick]')) { S.pick = null; map.closePopup(); showNear(); }
    const ra = e.target.closest('[data-rate]'); if (ra) return rateDialog(+ra.dataset.rate);
    const ph = e.target.closest('[data-photo]'); if (ph) return photoDialog(+ph.dataset.photo);
  });
  /* ---------- Bedømmelser og billeder (kun når Supabase er sat op) ---------- */
  function fillRv(id) { if (window.Reviews && Reviews.enabled) Reviews.fill($('nearestCard'), id); }
  function rateDialog(id) {
    const t = byId.get(id); let v = 0;
    dialog(`<h2>Hvor rent var der?</h2><p class="small">${esc(title(t))}</p>
      <div class="star-pick" role="radiogroup" aria-label="Renlighed fra 1 til 5 stjerner">${[1, 2, 3, 4, 5].map(i => `<button type="button" role="radio" aria-checked="false" data-star="${i}" aria-label="${i} ${i === 1 ? 'stjerne' : 'stjerner'}">${Reviews.STAR}</button>`).join('')}</div>
      <div class="star-txt" id="starTxt">Vælg 1–5 stjerner</div>
      <label class="fld">Kort kommentar (valgfri)<textarea id="rvComment" maxlength="280" rows="3" placeholder="Fx: Rent og pænt, men intet papir"></textarea></label>
      <p class="small">Kommentarer vises først, når de er godkendt. Skriv ikke navne eller andre personoplysninger.</p>`,
      [['Send bedømmelse', async () => {
        if (!v) { toastMsg('Vælg først antal stjerner.'); return rateDialog(id); }
        try { const r = await Reviews.rate(id, v, $('rvComment') ? $('rvComment').value : ''); toastMsg(r.moderated ? 'Tak! Stjernerne tæller med det samme. Kommentaren vises, når den er godkendt.' : 'Tak for din bedømmelse!'); fillRv(id); }
        catch (e) { toastMsg(Reviews.why(e)); }
      }], ['Annullér', null]]);
    const lbl = ['', 'Meget beskidt', 'Beskidt', 'Okay', 'Rent', 'Meget rent'];
    $('dlgBody').querySelectorAll('[data-star]').forEach(b => b.addEventListener('click', () => {
      v = +b.dataset.star; $('dlgBody').querySelectorAll('[data-star]').forEach(x => { const on = +x.dataset.star <= v; x.classList.toggle('on', on); x.setAttribute('aria-checked', +x.dataset.star === v); });
      $('starTxt').textContent = v + ' af 5 – ' + lbl[v];
    }));
  }
  function photoDialog(id) {
    const t = byId.get(id);
    dialog(`<h2>Del et billede af toilettet</h2><p class="small">${esc(title(t))}</p>
      <label class="btn-big secondary file-btn">Vælg eller tag et billede<input type="file" id="rvFile" accept="image/*" hidden></label>
      <div id="rvPrev" class="rv-prev"></div>
      <ul class="small rv-rules"><li>Billedet bliver mindre, og <b>placering og andre skjulte oplysninger (EXIF/GPS) fjernes</b> på din telefon, før det sendes.</li><li>Det vises først, når det er godkendt.</li><li>Ingen personer på billedet, tak.</li></ul>`,
      [['Send billede', async () => {
        const f = S._file; if (!f) { toastMsg('Vælg først et billede.'); return photoDialog(id); }
        try { await Reviews.uploadPhoto(id, f); toastMsg('Tak! Billedet vises, når det er godkendt.'); }
        catch (e) { toastMsg(e.message && !e.status ? e.message : Reviews.why(e)); }
        S._file = null;
      }], ['Annullér', () => { S._file = null; }]]);
    $('rvFile').addEventListener('change', e => {
      const f = e.target.files[0]; S._file = f || null; if (!f) return;
      Reviews.processImage(f).then(r => { $('rvPrev').innerHTML = `<img src="${URL.createObjectURL(r.blob)}" alt="Forhåndsvisning"><span class="small">${r.w}×${r.h} px · ${Math.round(r.blob.size / 1024)} kB · uden placering</span>`; })
        .catch(err => { $('rvPrev').textContent = err.message; S._file = null; });
    });
  }
  function toastMsg(m) {
    let el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = m; el.classList.add('on'); clearTimeout(S._tt); S._tt = setTimeout(() => el.classList.remove('on'), 4200);
  }
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    const k = c.dataset.filter; S.filters.has(k) ? S.filters.delete(k) : S.filters.add(k);
    c.setAttribute('aria-pressed', S.filters.has(k)); drawMarkers(); S.pick = null; showNear();
  }));

  /* ---------- Vis vej ---------- */
  let navLine = null, routeLine = null;
  function startNav(id) {
    const t = byId.get(id); if (!t) return;
    if (!S.me) { tapMode('Vi skal først vide, hvor du er. Tryk på kortet, der hvor du står.'); return; }
    map.closePopup(); S.nav = { t, route: null, routeFrom: null }; select(id, false);
    show('viewNav'); $('panel').scrollTop = 0; $('navName').textContent = 'Til: ' + title(t);
    $('lnkGoogle').href = gmaps(t); $('lnkApple').href = amaps(t);
    $('btnRoute').hidden = false; $('btnRoute').textContent = 'Tegn ruten ad gaderne';
    askCompass();
    setTimeout(() => map.fitBounds(L.latLngBounds([[S.me.lat, S.me.lon], [t.lat, t.lon]]).pad(0.2), Object.assign({ maxZoom: 18 }, fitPad())), 0);
    if (S.routeOK) fetchRoute();
    updateNav();
  }
  function stopNav() {
    S.nav = null; if (navLine) { map.removeLayer(navLine); navLine = null; } if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    showNear();
  }
  function remainingOnRoute(route) {
    // find nærmeste punkt på ruten og læg resten sammen
    let bi = 0, bd = Infinity; const c = route.coords;
    for (let i = 0; i < c.length; i++) { const d = dist(S.me, c[i]); if (d < bd) { bd = d; bi = i; } }
    let sum = bd; for (let i = bi; i < c.length - 1; i++) sum += dist(c[i], c[i + 1]);
    return { sum, off: bd, next: c[Math.min(bi + 3, c.length - 1)] };
  }
  function updateNav() {
    const N = S.nav; if (!N || !S.me) return;
    const t = N.t, straight = dist(S.me, t);
    let shown = straight, isRoute = false, aim = t;
    if (N.route) {
      const r = remainingOnRoute(N.route); shown = r.sum; isRoute = true; aim = r.next;
      if (r.off > 60 && S.routeOK && (!N.routeFrom || dist(N.routeFrom, S.me) > 40)) fetchRoute();
    }
    if (!navLine) navLine = L.polyline([], { color: '#1652f0', weight: 5, dashArray: '8 10', opacity: N.route ? 0 : .9 }).addTo(map);
    navLine.setLatLngs([[S.me.lat, S.me.lon], [t.lat, t.lon]]).setStyle({ opacity: N.route ? 0 : .9 });
    if (straight < 25) {
      $('navDist').innerHTML = '<span class="arrived">Du er fremme!</span>'; $('navTime').textContent = ''; $('navDir').textContent = 'Toilettet er lige i nærheden.';
      $('navArrow').style.transform = 'rotate(-90deg)'; return;
    }
    const b = bearing(S.me, aim.lat !== undefined ? aim : t);
    $('navDist').textContent = fmtDist(shown);
    $('navTime').textContent = fmtWalk(shown, isRoute);
    let txt = `Gå mod ${dirName(b)}.`, rot = b;
    if (S.heading != null) {
      rot = (b - S.heading + 360) % 360;
      const rel = rot > 180 ? rot - 360 : rot;
      txt += Math.abs(rel) < 25 ? ' Lige ud.' : Math.abs(rel) > 150 ? ' Vend om.' : rel > 0 ? (rel < 70 ? ' Lidt til højre.' : ' Til højre.') : (rel > -70 ? ' Lidt til venstre.' : ' Til venstre.');
      $('navNote').textContent = S.headingSrc === 'compass' ? 'Pilen følger telefonens kompas.' : 'Pilen følger den retning, du går.';
    } else {
      $('navNote').textContent = 'Pilen viser retningen på kortet (nord er opad). ' + (N.route ? 'Følg den blå rute.' : 'Den stiplede linje er fugleflugt – følg gader og fortove.');
    }
    $('navArrow').style.transform = `rotate(${rot - 90}deg)`;
    $('navDir').textContent = txt;
  }
  /* Kompas (frivilligt, kræver tilladelse på iPhone) */
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
    if (h == null) return;
    const scr = (screen.orientation && screen.orientation.angle) || 0;
    S.heading = (h + scr) % 360; S.headingSrc = 'compass';
    if (S.nav) { clearTimeout(S.oT); S.oT = setTimeout(updateNav, 120); }
  }
  function askCompass() {
    if (S.compassAsked) return; S.compassAsked = true;
    const D = window.DeviceOrientationEvent; if (!D) return;
    const add = () => { window.addEventListener('deviceorientationabsolute', onOrient); window.addEventListener('deviceorientation', onOrient); };
    if (typeof D.requestPermission === 'function') D.requestPermission().then(r => { if (r === 'granted') add(); }).catch(() => { });
    else add();
  }
  /* Rute ad gaderne – kun efter samtykke */
  $('btnRoute').addEventListener('click', () => {
    if (S.routeOK) return fetchRoute();
    dialog(`<h2>Tegn ruten ad gaderne?</h2>
      <p>For at tegne ruten sendes din position og toilettets position til en gratis rute-tjeneste (routing.openstreetmap.de, drevet af FOSSGIS e.V.).</p>
      <p>Der sendes intet navn eller andet om dig. Du kan også lade være og bruge pilen.</p>`,
      [['Ja, tegn ruten', () => { S.routeOK = true; fetchRoute(); }], ['Nej tak', null]]);
  });
  async function fetchRoute() {
    const N = S.nav; if (!N || !S.me) return;
    N.routeFrom = { lat: S.me.lat, lon: S.me.lon };
    $('btnRoute').textContent = 'Henter rute …';
    try {
      const url = `${ROUTER}${S.me.lon.toFixed(5)},${S.me.lat.toFixed(5)};${N.t.lon},${N.t.lat}?overview=full&geometries=geojson`;
      const r = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer' });
      const j = await r.json();
      if (j.code !== 'Ok' || !j.routes.length) throw new Error('ingen rute');
      if (S.nav !== N) return;
      N.route = { coords: j.routes[0].geometry.coordinates.map(c => ({ lon: c[0], lat: c[1] })), distance: j.routes[0].distance };
      N.route.coords.push({ lat: N.t.lat, lon: N.t.lon });
      if (routeLine) map.removeLayer(routeLine);
      routeLine = L.polyline(N.route.coords.map(c => [c.lat, c.lon]), { color: '#1652f0', weight: 8, opacity: .9 }).addTo(map);
      $('btnRoute').hidden = true;
      updateNav();
    } catch (e) {
      $('btnRoute').textContent = 'Prøv igen at tegne ruten';
      $('navNote').textContent = 'Ruten kunne ikke hentes (måske ingen internetforbindelse). Følg pilen eller brug Google Maps / Apple Kort.';
    }
  }
  $('btnStop').addEventListener('click', stopNav);

  /* ---------- Dialog ---------- */
  function dialog(html, buttons) {
    const d = $('dlg'); $('dlgBody').innerHTML = html;
    const form = d.querySelector('form'); form.innerHTML = '';
    (buttons || [['OK', null]]).forEach(([label, fn], i) => {
      const b = document.createElement('button'); b.className = 'btn-big ' + (i ? 'secondary' : 'primary'); b.textContent = label;
      b.addEventListener('click', () => { setTimeout(() => fn && fn(), 0); }); form.appendChild(b);
    });
    d.showModal ? d.showModal() : d.setAttribute('open', '');
  }
  /* ---------- Hjælp: slå placering til ---------- */
  const ICO = {
    gear: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#8e8e93"/><circle cx="24" cy="24" r="12" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="5 3.4"/><circle cx="24" cy="24" r="5" fill="#fff"/></svg>',
    hand: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#1a73e8"/><path d="M17 34V20a2.5 2.5 0 015 0v-6a2.5 2.5 0 015 0v5a2.5 2.5 0 015 0v2a2.5 2.5 0 015 0v8c0 6-4 9-9 9h-2c-4 0-6-2-9-6z" fill="#fff"/></svg>',
    loc: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#1a73e8"/><path d="M35 12L13 22l10 3 3 10z" fill="#fff"/></svg>',
    safari: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#fff" stroke="#bbb"/><circle cx="24" cy="24" r="16" fill="#1a8cff"/><path d="M31 17l-5 9-9 5 5-9z" fill="#fff"/><path d="M31 17l-5 9-4-4z" fill="#ff3b30"/></svg>',
    aa: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#e5e5ea"/><text x="24" y="31" font-size="20" font-family="system-ui,sans-serif" font-weight="700" text-anchor="middle" fill="#111"><tspan font-size="13">a</tspan>A</text></svg>',
    reload: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#1e7b34"/><path d="M34 22a10 10 0 10-3 9" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M36 13v10h-10z" fill="#fff"/></svg>',
    compass: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#5856d6"/><circle cx="24" cy="24" r="14" fill="none" stroke="#fff" stroke-width="3"/><path d="M24 12l4 12h-8z" fill="#ff3b30"/><path d="M24 36l-4-12h8z" fill="#fff"/></svg>',
    pin: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#1a73e8"/><path d="M24 38s-10-10-10-17a10 10 0 0120 0c0 7-10 17-10 17z" fill="#fff"/><circle cx="24" cy="21" r="4" fill="#1a73e8"/></svg>',
    lock: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#e5e5ea"/><rect x="14" y="22" width="20" height="15" rx="3" fill="#333"/><path d="M18 22v-4a6 6 0 0112 0v4" fill="none" stroke="#333" stroke-width="3.5"/></svg>',
    chrome: '<svg viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#fff" stroke="#bbb"/><circle cx="24" cy="24" r="15" fill="#db4437"/><path d="M24 24L11 31.5A15 15 0 0024 39z" fill="#0f9d58"/><path d="M24 24l13-7.5A15 15 0 0124 39z" fill="#f4b400"/><path d="M24 24L11 31.5A15 15 0 019 24a15 15 0 012-7.5z" fill="#0f9d58"/><circle cx="24" cy="24" r="7" fill="#fff"/><circle cx="24" cy="24" r="5" fill="#4285f4"/></svg>'
  };
  const step = (n, ico, html) => `<li class="hstep"><span class="hico" aria-hidden="true">${ICO[ico]}</span><div><b class="hnum">${n}.</b> ${html}</div></li>`;
  const HELP_IOS = `<ol class="hsteps">
    ${step(1, 'gear', 'Åbn <b>Indstillinger</b> på din iPhone.')}
    ${step(2, 'hand', 'Tryk <b>Anonymitet og sikkerhed</b> → <b>Lokalitetstjenester</b>. Sørg for, at <b>Lokalitetstjenester</b> er slået <b>til</b> (grøn).')}
    ${step(3, 'safari', 'Rul ned og tryk <b>Safari-websteder</b>. Vælg <b>Når appen er i brug</b>, og slå <b>Nøjagtig lokalitet</b> til.')}
    ${step(4, 'aa', 'Gå tilbage til Safari. Tryk på <b>aA</b> (eller <b>⋯</b>) i adresselinjen → <b>Webstedsindstillinger</b> → <b>Lokalitet</b>: vælg <b>Tillad</b>.')}
    ${step(5, 'reload', 'Genindlæs siden, og tryk <b>Prøv igen</b> nedenfor.')}
    </ol>
    <div class="hnote">${ICO.compass}<div><b>Pilen (kompasset):</b> Hvis pilen ikke drejer med telefonen, så gå til <b>Indstillinger → Safari → Bevægelse og retning</b> og slå det til.</div></div>`;
  const HELP_AND = `<ol class="hsteps">
    ${step(1, 'gear', 'Åbn <b>Indstillinger</b> på din telefon.')}
    ${step(2, 'pin', 'Tryk <b>Placering</b>, og slå <b>Brug placering</b> til.')}
    ${step(3, 'chrome', 'Gå tilbage til <b>Chrome</b>.')}
    ${step(4, 'lock', 'Tryk på <b>lås-ikonet</b> (eller indstillings-ikonet) til venstre for adressen → <b>Tilladelser</b> → <b>Placering</b> → <b>Tillad</b>.')}
    ${step(5, 'reload', 'Genindlæs siden, og tryk <b>Prøv igen</b> nedenfor.')}
    </ol>`;
  const isAndroid = () => /android/i.test(navigator.userAgent);
  function helpDialog() {
    const tab = isAndroid() ? 'and' : 'ios';
    const d = $('dlg'); if (d.open) d.close();
    dialog(`<h2>Slå placering til</h2>
      <p>Telefonen spørger kun én gang. Har du sagt nej, skal du selv slå det til sådan her:</p>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" class="tab" data-tab="ios" aria-selected="${tab === 'ios'}">iPhone</button>
        <button type="button" role="tab" class="tab" data-tab="and" aria-selected="${tab === 'and'}">Android</button>
      </div>
      <div class="tabpanel" data-panel="ios" ${tab === 'ios' ? '' : 'hidden'}>${HELP_IOS}</div>
      <div class="tabpanel" data-panel="and" ${tab === 'and' ? '' : 'hidden'}>${HELP_AND}</div>
      <p class="small">Din placering bliver kun på din telefon.</p>`,
      [['Prøv igen', retryGPS], ['Luk', null]]);
    d.classList.add('help');
  }
  $('dlgBody').addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      $('dlgBody').querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', b === t));
      $('dlgBody').querySelectorAll('[data-panel]').forEach(p => p.hidden = p.dataset.panel !== t.dataset.tab);
      return;
    }
    if (e.target.closest('[data-help]')) helpDialog();
  });
  $('dlg').addEventListener('close', () => $('dlg').classList.remove('help'));
  const M = DATA.metadata, gen = new Date(M.generated).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
  $('btnInfo').addEventListener('click', () => dialog(`<h2>Om appen</h2>
    <p>Kortet viser ${M.counts.total} toiletter i København og på Frederiksberg. Data er fra ${gen}.</p>
    <p><b>Farver på kortet:</b> grøn = åbent nu, grå = lukket nu, blå = åbningstid ukendt.</p>
    <p><b>Handicapvenligt:</b> "Ikke angivet som handicapvenligt" betyder, at kommunen ikke har registreret toilettet som handicapvenligt – det kan godt være tilgængeligt. "Ukendt" betyder, at vi ikke har oplysningen.</p>
    <p><b>Bedømmelser og billeder:</b> ${window.Reviews && Reviews.enabled ? 'Stjerner tæller med det samme. Kommentarer og billeder vises først, når de er godkendt. Billeder får fjernet placering (EXIF/GPS) på din telefon.' : 'kommer snart.'}</p>
    <p><b>Din position</b> bliver på din telefon. Appen har ingen konti og ingen sporing. Kortbillederne hentes fra OpenStreetMap. Kun hvis du selv vælger "Tegn ruten ad gaderne", sendes start og mål til en rute-tjeneste.</p>
    <button type="button" class="btn-big secondary" data-help="1">Hjælp: slå placering til</button>
    <p><b>Pas på:</b> Åbningstider kan være forkerte, og nogle toiletter kan være lukkede eller mangle. Tiderne for kommunens toiletter er omtrentlige.</p>
    <p class="small"><b>Kilder:</b> Københavns Kommune (åbne data, CC0) · Frederiksberg Kommune (CC BY 4.0) · © OpenStreetMap-bidragydere (ODbL 1.0). Kort: © OpenStreetMap. Rute: OSRM / FOSSGIS. Kortprogram: Leaflet.</p>`));

  /* ---------- Start ---------- */
  $('btnFind').addEventListener('click', startGPS);
  $('btnTap').addEventListener('click', () => tapMode());
  $('btnLocate').addEventListener('click', () => { if (S.me && S.me.src === 'gps') map.setView([S.me.lat, S.me.lon], Math.max(map.getZoom(), 16)); else retryGPS(); });
  drawMarkers();
  // Har brugeren før givet lov? Så start GPS med det samme.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(p => { if (p.state === 'granted') startGPS(); }).catch(() => { });
  }
  setInterval(() => { if (!S.nav) { drawMarkers(); showNear(); } }, 5 * 60 * 1000); // åbent/lukket ændrer sig med tiden
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });

  window.__app = { access, rateDialog, photoDialog, helpDialog, retryGPS, S, F, nearest, dist, visible, startNav, stopNav, setMe, fmtWalk, map, markers };
})();
