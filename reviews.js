/* Bedømmelser (renlighed 1–5 + kort kommentar) og brugerbilleder via Supabase.
   Slået fra, når config.js er tom: så laves der ingen netværkskald, og UI viser "kommer snart".
   Ingen konti: et tilfældigt enheds-id i localStorage bruges kun til begrænsning af antal indsendelser.
   Billeder tegnes om på et lærred før upload → EXIF (inkl. GPS) fjernes, og billedet gøres mindre. */
(function () {
  'use strict';
  const C = window.TOILET_CONFIG || {};
  const URL0 = String(C.supabaseUrl || '').replace(/\/+$/, ''), KEY = String(C.supabaseAnonKey || '');
  const enabled = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(URL0) && KEY.length > 20;
  const BUCKET = 'toilet-photos', MAX_SIDE = 1280, QUALITY = 0.82, MAX_IN = 25 * 1024 * 1024;
  const H = (extra) => Object.assign({ apikey: KEY, Authorization: 'Bearer ' + KEY }, extra || {});
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? r : (r & 3) | 8).toString(16); })); }
  function deviceId() { let d = localStorage.getItem('toilet_device'); if (!d) { d = uuid(); localStorage.setItem('toilet_device', d); } return d; }
  const sum = new Map();   // toilet_id -> {avg, n}
  async function rest(path, opt) {
    const r = await fetch(URL0 + '/rest/v1/' + path, Object.assign({ referrerPolicy: 'no-referrer', cache: 'no-store' }, opt, { headers: H((opt || {}).headers) }));
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; try { e.body = await r.text(); } catch (x) { } throw e; }
    return r.status === 204 || r.status === 201 && !(opt && opt.wantBody) ? null : r.json();
  }
  async function loadSummary(ids) {
    if (!enabled) return;
    const need = ids.filter(i => !sum.has(i)); if (!need.length) return;
    try {
      const rows = await rest('rating_summary?select=toilet_id,avg_stars,n&toilet_id=in.(' + need.join(',') + ')');
      need.forEach(i => sum.set(i, { avg: 0, n: 0 }));
      rows.forEach(r => sum.set(r.toilet_id, { avg: +r.avg_stars, n: +r.n }));
    } catch (e) { /* ingen net – vis bare uden */ }
  }
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>';
  function starsHtml(v, cls) { let h = ''; for (let i = 1; i <= 5; i++) h += `<span class="s${v >= i - 0.25 ? ' on' : v >= i - 0.75 ? ' half' : ''}">${STAR}</span>`; return `<span class="stars ${cls || ''}" aria-hidden="true">${h}</span>`; }
  const fmt = v => v.toFixed(1).replace('.', ',');
  function miniHtml(id) {
    if (!enabled) return ''; const s = sum.get(id); if (!s || !s.n) return '';
    return `<span class="mini-rate" aria-label="Renlighed ${fmt(s.avg)} af 5, ${s.n} bedømmelser">${STAR}${fmt(s.avg)} <small>(${s.n})</small></span>`;
  }
  /* Blok i toiletkortet. Foto-plads + bedømmelse. */
  function blockHtml(id) {
    if (!enabled) return `<div class="rv soon" data-rv-soon="1"><span class="rv-ico">${STAR}</span><div><b>Bedømmelser og billeder kommer snart</b><div class="small">Snart kan du give toilettet stjerner for renlighed og dele et billede.</div></div></div>`;
    return `<div class="rv" data-rv="${id}"><div class="rv-photos" data-photos="${id}"></div>
      <div class="rv-sum" data-sum="${id}">${sumHtml(id)}</div>
      <div class="rv-comments" data-comments="${id}"></div>
      <div class="row2"><button type="button" class="btn-mid" data-rate="${id}">${STAR}Bedøm renlighed</button><button type="button" class="btn-mid" data-photo="${id}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2.5L9 4h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>Tilføj billede</button></div></div>`;
  }
  function sumHtml(id) {
    const s = sum.get(id);
    if (!s) return '<span class="small">Henter bedømmelser …</span>';
    if (!s.n) return '<span class="small">Ingen bedømmelser endnu – vær den første.</span>';
    return `${starsHtml(s.avg)}<b class="rate-num">${fmt(s.avg)}</b><span class="small">Renlighed · ${s.n} ${s.n === 1 ? 'bedømmelse' : 'bedømmelser'}</span>`;
  }
  const blobUrls = new Map();
  async function photoUrl(path) {
    if (blobUrls.has(path)) return blobUrls.get(path);
    const r = await fetch(URL0 + '/storage/v1/object/authenticated/' + BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/'), { headers: H(), referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error('foto ' + r.status);
    const u = URL.createObjectURL(await r.blob()); blobUrls.set(path, u); return u;
  }
  async function fill(root, id) {
    if (!enabled || !root) return;
    await loadSummary([id]);
    const q = s => root.querySelector(s);
    if (q(`[data-sum="${id}"]`)) q(`[data-sum="${id}"]`).innerHTML = sumHtml(id);
    try {
      const ph = await rest(`photos?select=path&toilet_id=eq.${id}&status=eq.approved&order=created_at.desc&limit=6`);
      const box = q(`[data-photos="${id}"]`);
      if (box && ph.length) {
        const urls = await Promise.all(ph.map(p => photoUrl(p.path).catch(() => null)));
        box.innerHTML = urls.filter(Boolean).map((u, i) => `<img src="${u}" alt="Billede ${i + 1} af toilettet, delt af en bruger" loading="lazy">`).join('');
      }
      const cm = await rest(`ratings?select=stars,comment,created_at&toilet_id=eq.${id}&status=eq.approved&comment=not.is.null&order=created_at.desc&limit=3`);
      const cb = q(`[data-comments="${id}"]`);
      if (cb) cb.innerHTML = cm.map(c => `<blockquote>${starsHtml(c.stars, 'sm')}<span>${esc(c.comment)}</span><small>${new Date(c.created_at).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}</small></blockquote>`).join('');
    } catch (e) { }
  }
  async function rate(id, stars, comment) {
    stars = Math.round(+stars); if (!(stars >= 1 && stars <= 5)) throw new Error('stjerner');
    comment = String(comment || '').trim().slice(0, 280) || null;
    await rest('ratings', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ toilet_id: id, stars, comment, device_id: deviceId() }) });
    sum.delete(id);
    return { moderated: !!comment };
  }
  /* Tegn billedet om: fjerner EXIF/GPS (lærredet har kun pixels) og gør det højst 1280 px. */
  async function processImage(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error('Det er ikke et billede.');
    if (file.size > MAX_IN) throw new Error('Billedet er for stort (højst 25 MB).');
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { src = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('Billedet kunne ikke læses.')); im.src = URL.createObjectURL(file); }); }
    const w0 = src.width, h0 = src.height, k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', QUALITY));
    return { blob, w, h };
  }
  async function uploadPhoto(id, file) {
    const { blob, w, h } = await processImage(file);
    const path = `${id}/${uuid()}.jpg`;
    await rest('photos', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ toilet_id: id, path, device_id: deviceId(), width: w, height: h, bytes: blob.size }) });
    const r = await fetch(URL0 + '/storage/v1/object/' + BUCKET + '/' + path, { method: 'POST', headers: H({ 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }), body: blob, referrerPolicy: 'no-referrer' });
    if (!r.ok) { const e = new Error('upload ' + r.status); e.status = r.status; throw e; }
    return { path, w, h, bytes: blob.size };
  }
  const why = e => e && (e.status === 429 || /rate|for mange|too many/i.test(e.body || '')) ? 'Du har sendt mange på kort tid. Prøv igen i morgen.' : 'Det kunne ikke sendes lige nu. Tjek din internetforbindelse og prøv igen.';
  window.Reviews = { STAR, enabled, loadSummary, miniHtml, blockHtml, fill, rate, uploadPhoto, processImage, starsHtml, deviceId, why, _sum: sum };
})();
