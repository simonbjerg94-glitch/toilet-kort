/* Åbningstider: returnerer {state:'open'|'closed'|'unknown', text, approx}
   Forstår: "24/7", KK's "kk_natlukket", vinterlukning og en enkel delmængde af OSM opening_hours. */
(function (root) {
  const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const pad = n => String(n).padStart(2, '0');
  const hm = m => (m % 1440 === 0 ? 'midnat' : pad(Math.floor(m / 60) % 24) + '.' + pad(m % 60));

  function parseDays(s) {
    const set = new Set();
    for (const part of s.split(',')) {
      const m = part.trim().match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
      if (!m) return null;
      let i = ORDER.indexOf(m[1]); const j = ORDER.indexOf(m[2] || m[1]);
      for (let k = 0; k < 7; k++) { set.add(ORDER[(i + k) % 7]); if ((i + k) % 7 === j) break; }
    }
    return set;
  }
  function parseTimes(s) {
    const out = [];
    for (const part of s.split(',')) {
      const m = part.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const a = +m[1] * 60 + +m[2]; let b = +m[3] * 60 + +m[4];
      if (b <= a) b += 24 * 60; // over midnat
      out.push([a, b]);
    }
    return out;
  }
  /* Returnerer map dag -> [[start,slut],...] eller null hvis formatet ikke forstås */
  function parseOSM(oh) {
    oh = (oh || '').trim();
    if (!oh) return null;
    if (oh === '24/7') { const r = {}; ORDER.forEach(d => r[d] = [[0, 1440]]); return r; }
    const res = {};
    oh = oh.replace(/\s*-\s*/g, '-').replace(/(\d),\s*(?=(Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, '$1;')
      .replace(/,\s*PH\b/g, '').replace(/,\s+(?=(Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, ',');
    for (let rule of oh.split(';')) {
      rule = rule.trim(); if (!rule) continue;
      if (/\bPH\b|\bSH\b/.test(rule)) { if (/^PH\s+off$/.test(rule) || /^PH\b/.test(rule)) continue; return null; }
      let days = new Set(ORDER), rest = rule;
      const dm = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:[-,](?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(.*)$/);
      if (dm) { days = parseDays(dm[1]); rest = dm[2]; if (!days) return null; }
      let times;
      if (rest === 'off' || rest === 'closed') times = [];
      else if (rest === '24/7' || rest === '00:00-24:00') times = [[0, 1440]];
      else { times = parseTimes(rest); if (!times) return null; }
      days.forEach(d => res[d] = times);
    }
    return Object.keys(res).length ? res : null;
  }
  function osmState(oh, date) {
    const t = parseOSM(oh); if (!t) return null;
    const mins = date.getHours() * 60 + date.getMinutes();
    const today = DAYS[date.getDay()], yest = DAYS[(date.getDay() + 6) % 7];
    for (const [a, b] of (t[today] || [])) if (mins >= a && mins < b) return { state: 'open', text: b >= 1440 && a === 0 ? 'Åbent hele dagen' : (hm(b) === 'midnat' ? 'Åbent til midnat' : 'Åbent til kl. ' + hm(b)) };
    for (const [a, b] of (t[yest] || [])) if (b > 1440 && mins < b - 1440) return { state: 'open', text: 'Åbent til kl. ' + hm(b) };
    const next = (t[today] || []).map(x => x[0]).filter(a => a > mins).sort((x, y) => x - y)[0];
    return { state: 'closed', text: next !== undefined ? 'Lukket nu – åbner kl. ' + hm(next) : 'Lukket nu' };
  }
  function openState(p, date) {
    date = date || new Date();
    const month = date.getMonth() + 1; // 1-12
    let seasonUnsure = false;
    if (p.season === 'vinterlukket') {
      if ([12, 1, 2].includes(month)) return { state: 'closed', text: 'Lukket for vinteren' };
      if ([10, 11, 3, 4].includes(month)) seasonUnsure = true;
    }
    let r = null;
    if (p.hours === '24/7') r = { state: 'open', text: 'Åbent døgnet rundt' };
    else if (p.hours === 'kk_natlukket') {
      const summer = month >= 4 && month <= 9;
      const mins = date.getHours() * 60 + date.getMinutes();
      const close = summer ? 21 * 60 : 19 * 60;
      r = (mins >= 4 * 60 + 30 && mins < close)
        ? { state: 'open', text: 'Åbent til ca. kl. ' + hm(close), approx: true }
        : { state: 'closed', text: 'Lukket om natten (åbner ca. kl. 04.30)', approx: true };
    } else if (p.hours) r = osmState(p.hours, date);
    if (!r) return { state: 'unknown', text: p.hours_text ? 'Åbningstid: ' + p.hours_text : 'Åbningstid ukendt' };
    if (seasonUnsure && r.state === 'open') return { state: 'unknown', text: r.text + ' – men kan være lukket for vinteren', approx: true };
    return r;
  }
  root.Hours = { openState, parseOSM };
  if (typeof module !== 'undefined') module.exports = root.Hours;
})(typeof window !== 'undefined' ? window : globalThis);
