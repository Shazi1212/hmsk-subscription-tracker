/* UI for the subscription tracker. Logic lives in logic.js, texts in i18n.js. */
(function () {
  'use strict';
  var L = window.SubTracker;
  var I = window.SUB_I18N;
  var CFG = window.SUB_CONFIG || {};
  var SITE = CFG.siteBase || '';
  var KEY = 'hmsk-subscription-tracker-v1';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var store = load();
  var lang = pickLang();
  var today = L.todayISO();
  var editing = null; // id of the subscription in the form, or null when adding

  // ---------- storage ----------
  var storageOk = true;
  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var d = raw ? JSON.parse(raw) : null;
      if (d && Array.isArray(d.subs)) {
        return { subs: d.subs.map(function (s) { return L.normalize(s); }).filter(function (r) { return !r.errors.length; }).map(function (r) { return r.sub; }), settings: d.settings || {} };
      }
    } catch (e) { /* fall through */ }
    return { subs: [], settings: {} };
  }
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify({ v: 1, subs: store.subs, settings: store.settings })); storageOk = true; }
    catch (e) { storageOk = false; }
    $('#storageWarn').hidden = storageOk;
  }

  function pickLang() {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'de' || q === 'en') return q;
    if (store.settings.lang === 'de' || store.settings.lang === 'en') return store.settings.lang;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    return /^de\b/i.test(nav) ? 'de' : 'en';
  }
  // English dates follow the browser (US: month first, UK: day first).
  function locale() {
    if (lang === 'de') return 'de-DE';
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en-GB';
    return /^en\b/i.test(nav) ? nav : 'en-GB';
  }
  function defaultCurrency() {
    if (store.settings.currency) return store.settings.currency;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    if (/^en-US$/i.test(nav)) return 'USD';
    if (/^en-GB$/i.test(nav)) return 'GBP';
    if (/-CH$/i.test(nav)) return 'CHF';
    return 'EUR';
  }

  function t(key, vars) {
    var s = I[lang][key];
    if (s === undefined) s = I.en[key];
    if (vars && typeof s === 'string') Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function fmtDate(iso, short) {
    var p = iso.split('-');
    var o = short ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
    return new Intl.DateTimeFormat(locale(), o).format(new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])));
  }
  function money(centsVal, cur) {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: cur }).format(centsVal / 100);
  }
  function link(href) { return SITE + href; }
  function slug(s) { return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'subscription'; }
  function toolUrl() { return link(t('home_href')).indexOf('http') === 0 ? link(t('home_href')) : location.origin + location.pathname + (lang === 'de' ? '?lang=de' : ''); }

  // Kündigung generator (hmsk.life tool #12). Query: provider, type (gym|mobile|insurance|streaming|other), end (YYYY-MM-DD, last paid day), lang.
  function kuendigungUrl(sub, sch) {
    var q = new URLSearchParams({ provider: sub.name, type: L.KUENDIGUNG_TYPE[sub.category] || 'other', end: L.addDays(L.activeDeadline(sch).renewal, -1), lang: lang });
    return link('/apps/kuendigung/') + '?' + q.toString();
  }

  // ---------- static texts ----------
  function options(sel, values, prefix) {
    var cur = sel.value;
    sel.innerHTML = values.map(function (v) { return '<option value="' + v + '">' + esc(t(prefix + v)) + '</option>'; }).join('');
    if (cur) sel.value = cur;
  }
  function applyLang() {
    document.documentElement.lang = lang;
    document.title = t('title');
    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('[data-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-ph')); });
    $$('.lang button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)); });
    $('#lnkHome').href = link(t('home_href'));
    $('#lnkImprint').href = link(t('imprint_href')); $('#lnkImprint').textContent = t('imprint');
    $('#lnkPrivacy').href = link(t('privacy_href')); $('#lnkPrivacy').textContent = t('privacy');
    $('#mailLink').href = link(t('contact_href'));
    options($('#cycleSel'), Object.keys(L.CYCLES), 'cycle_');
    options($('#unitSel'), L.UNITS, 'unit_');
    options($('#catSel'), L.CATEGORIES, 'cat_');
    $('#formTitle').textContent = t(editing ? 'form_edit' : 'form_add');
    $('#saveBtn').textContent = t(editing ? 'save_edit' : 'save_add');
    $('#tipsList').innerHTML = t('tips').map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('#sourcesList').innerHTML = t('src').map(function (s) {
      return '<li><a href="' + esc(s[1]) + '" rel="noopener" target="_blank">' + esc(s[0]) + '</a></li>';
    }).join('');
  }

  // ---------- summary ----------
  function renderSummary(rows) {
    var el = $('#summary');
    if (!store.subs.length) { el.innerHTML = '<p class="dim">' + esc(t('none_yet')) + '</p>'; return; }
    var tot = L.totals(store.subs);
    var curs = Object.keys(tot).sort();
    var paused = store.subs.filter(function (s) { return s.paused; }).length;
    var html = '<div class="sum">';
    curs.forEach(function (c) {
      html += '<div class="sum__cell"><span class="sum__big">' + esc(money(tot[c].monthly, c)) + '</span><span class="sum__lbl">' + esc(t('per_month')) + '</span>' +
        '<span class="sum__mid">' + esc(money(tot[c].yearly, c)) + ' <span class="dim">' + esc(t('per_year')) + '</span></span>' +
        '<span class="sum__lbl">' + esc(tot[c].count === 1 ? t('subs_1') : t('subs_n', { n: tot[c].count })) + '</span></div>';
    });
    var first = rows.filter(function (r) { return !r.sub.paused; })[0];
    if (first) {
      var d = L.activeDeadline(first.sch);
      html += '<div class="sum__cell sum__cell--next"><span class="sum__lbl">' + esc(t('next_deadline')) + '</span>' +
        '<span class="sum__mid sum__mid--' + first.sch.status + '">' + esc(fmtDate(d.cancelBy)) + '</span>' +
        '<span class="sum__lbl">' + esc(first.sub.name) + ' ' + chip(first.sch, first.sub) + '</span></div>';
    }
    html += '</div>';
    // category breakdown for the biggest currency
    var main = curs.slice().sort(function (a, b) { return tot[b].yearly - tot[a].yearly; })[0];
    var cats = main ? L.byCategory(store.subs, main) : [];
    if (cats.length > 1) {
      var max = cats[0].yearly || 1;
      html += '<p class="sum__lbl sum__cats-t">' + esc(t('by_cat')) + (curs.length > 1 ? ' (' + main + ')' : '') + '</p><ul class="cats">' + cats.map(function (c) {
        return '<li><span class="cats__n">' + esc(t('cat_' + c.category)) + '</span><span class="cats__bar"><span style="width:' + Math.max(2, Math.round(c.yearly / max * 100)) + '%"></span></span><span class="cats__v">' + esc(money(c.yearly, main)) + '</span></li>';
      }).join('') + '</ul>';
    }
    if (paused) html += '<p class="sum__lbl">' + esc(t('paused_n', { n: paused })) + '</p>';
    el.innerHTML = html;
  }

  function chip(sch, sub) {
    if (sub.paused) return '<span class="chip">[' + esc(t('chip_paused')) + ']</span>';
    if (sch.status === 'missed') return '<span class="chip chip--missed">[' + esc(t('chip_missed')) + ']</span>';
    var n = sch.days;
    var label = n === 0 ? t('chip_today') : n === 1 ? t('chip_1day') : t('chip_days', { n: n });
    return '<span class="chip chip--' + sch.status + '">[' + esc(label) + ']</span>';
  }

  // ---------- list ----------
  function renderList(rows) {
    var el = $('#listBody');
    if (!rows.length) {
      el.innerHTML = '<p class="dim">' + esc(t('empty')) + '</p><button type="button" class="btn btn--line" id="exBtn">' + esc(t('examples')) + '</button>';
      $('#exBtn').addEventListener('click', loadExamples);
      return;
    }
    el.innerHTML = '<ul class="subs" role="list">' + rows.map(function (r) {
      var s = r.sub, sch = r.sch, d = L.activeDeadline(sch);
      var notice = s.notice.n ? t('notice_is', { n: s.notice.n, u: t((s.notice.n === 1 ? 'unit1_' : 'unit_') + s.notice.unit) }) : t('no_notice');
      var when = sch.status === 'missed'
        ? '<span class="sub__miss">' + esc(t('missed', { d: fmtDate(sch.renewal, true) })) + '</span> · <b>' + esc(t('next_chance', { d: fmtDate(d.cancelBy, true) })) + '</b>'
        : '<b>' + esc(t('cancel_by', { d: fmtDate(sch.cancelBy, true) })) + '</b> · ' + esc(t('renews', { d: fmtDate(sch.renewal, true) }));
      return '<li class="sub sub--' + (s.paused ? 'paused' : sch.status) + '" data-id="' + esc(s.id) + '">' +
        '<div class="sub__top"><span class="sub__name">' + esc(s.name) + '</span> ' + chip(sch, s) +
        '<span class="sub__price">' + esc(money(Math.round(s.price * 100), s.currency)) + ' <span class="dim">' + esc(t('per_' + s.cycle)) + '</span></span></div>' +
        '<div class="sub__when">' + when + '</div>' +
        '<div class="sub__meta dim">' + esc(t('cat_' + s.category)) + ' · ' + esc(notice) + (s.note ? ' · ' + esc(s.note) : '') + '</div>' +
        '<div class="sub__acts">' +
          '<button type="button" class="linkish" data-act="ics">' + esc(t('a_ics')) + '</button>' +
          '<a class="linkish linkish--go" data-act="cancel" href="' + esc(kuendigungUrl(s, sch)) + '">' + esc(t('a_cancel')) + ' &rarr;</a>' +
          '<button type="button" class="linkish" data-act="edit">' + esc(t('a_edit')) + '</button>' +
          '<button type="button" class="linkish linkish--danger" data-act="delete">' + esc(t('a_delete')) + '</button>' +
        '</div></li>';
    }).join('') + '</ul>';
  }

  function render() {
    today = L.todayISO();
    var rows = L.sorted(store.subs, today);
    renderSummary(rows);
    renderList(rows);
    $('#icsAllBtn').disabled = !store.subs.length;
    $('#exportBtn').disabled = !store.subs.length;
    $('#clearBtn').disabled = !store.subs.length;
  }

  // ---------- form ----------
  function readForm() {
    var f = $('#subForm');
    return {
      id: editing || undefined, name: f.name.value, price: f.price.value, currency: f.currency.value, cycle: f.cycle.value, next: f.next.value,
      notice: { n: f.noticeN.value === '' ? 0 : f.noticeN.value, unit: f.noticeUnit.value }, category: f.category.value, note: f.note.value, paused: f.paused.checked,
    };
  }
  function fillForm(s) {
    var f = $('#subForm');
    f.name.value = s ? s.name : ''; f.price.value = s ? String(s.price) : ''; f.currency.value = s ? s.currency : defaultCurrency();
    f.cycle.value = s ? s.cycle : 'monthly'; f.next.value = s ? s.next : ''; f.noticeN.value = s ? s.notice.n : 0;
    f.noticeUnit.value = s ? s.notice.unit : 'days'; f.category.value = s ? s.category : 'streaming'; f.note.value = s ? s.note : ''; f.paused.checked = s ? s.paused : false;
    $$('[data-err]').forEach(function (e) { e.hidden = true; });
  }
  function setEditing(id) {
    editing = id;
    var s = id ? store.subs.find(function (x) { return x.id === id; }) : null;
    fillForm(s);
    $('#formTitle').textContent = t(id ? 'form_edit' : 'form_add');
    $('#saveBtn').textContent = t(id ? 'save_edit' : 'save_add');
    $('#cancelEditBtn').hidden = !id;
    if (id) { $('#subForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#subForm').name.focus({ preventScroll: true }); }
  }
  function onSubmit(e) {
    e.preventDefault();
    var r = L.normalize(readForm());
    $$('[data-err]').forEach(function (el) {
      var k = el.getAttribute('data-err');
      el.hidden = r.errors.indexOf(k) === -1;
      el.textContent = t('err_' + k);
    });
    if (r.errors.length) { var bad = $('#subForm [name="' + (r.errors[0] === 'notice' ? 'noticeN' : r.errors[0]) + '"]'); if (bad) bad.focus(); return; }
    var wasEdit = !!editing;
    if (wasEdit) store.subs = store.subs.map(function (x) { return x.id === editing ? r.sub : x; });
    else store.subs.push(r.sub);
    store.settings.currency = r.sub.currency;
    save();
    setEditing(null);
    flash('#formMsg', t(wasEdit ? 'saved' : 'added'));
    render();
  }
  function flash(sel, msg) {
    var el = $(sel); el.textContent = msg;
    clearTimeout(el._t); el._t = setTimeout(function () { el.textContent = ''; }, 4000);
  }

  function loadExamples() {
    var n = t('ex_names');
    var cur = defaultCurrency();
    var ex = [
      { name: n[0], price: 13.99, cycle: 'monthly', next: L.addDays(today, 12), notice: { n: 0, unit: 'days' }, category: 'streaming' },
      { name: n[1], price: 29.9, cycle: 'monthly', next: L.addMonths(L.addDays(today, 3), 1), notice: { n: 1, unit: 'months' }, category: 'gym' },
      { name: n[2], price: 24.99, cycle: 'monthly', next: L.addDays(today, 40), notice: { n: 1, unit: 'months' }, category: 'mobile' },
      { name: n[3], price: 99.99, cycle: 'yearly', next: L.addMonths(today, 5), notice: { n: 14, unit: 'days' }, category: 'cloud' },
    ];
    store.subs = ex.map(function (x) { x.currency = cur; return L.normalize(x).sub; });
    save(); render();
  }

  // ---------- actions ----------
  function icsEvent(s) {
    var sch = L.schedule(s, today), d = L.activeDeadline(sch);
    return {
      uid: L.eventUid(s, d.cancelBy), date: d.cancelBy, url: L.TOOL_URL,
      summary: t('ics_summary', { name: s.name }),
      description: t('ics_desc', { name: s.name, d: fmtDate(d.cancelBy), r: fmtDate(d.renewal), price: money(Math.round(s.price * 100), s.currency) + ' ' + t('per_' + s.cycle),
        k: absolute(kuendigungUrl(s, sch)), url: toolUrl() }),
    };
  }
  function absolute(u) { return /^https?:/.test(u) ? u : location.origin + u; }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function onListClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var li = btn.closest('.sub'), id = li && li.getAttribute('data-id');
    var s = store.subs.find(function (x) { return x.id === id; });
    if (!s) return;
    var act = btn.getAttribute('data-act');
    if (act === 'ics') {
      var ev = icsEvent(s);
      download(t('ics_file', { slug: slug(s.name), d: ev.date }), L.buildICS([ev]), 'text/calendar;charset=utf-8');
    } else if (act === 'edit') setEditing(id);
    else if (act === 'delete') {
      if (!window.confirm(t('confirm_delete', { name: s.name }))) return;
      store.subs = store.subs.filter(function (x) { return x.id !== id; });
      if (editing === id) setEditing(null);
      save(); render(); flash('#formMsg', t('deleted'));
    }
  }

  function onImport(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var r;
      try { r = L.importJSON(String(rd.result)); } catch (err) { flash('#dataMsg', t('import_bad')); return; }
      if (store.subs.length && !window.confirm(t('confirm_import', { n: store.subs.length, m: r.subs.length }))) return;
      store.subs = r.subs; setEditing(null); save(); render();
      flash('#dataMsg', t('imported', { n: r.subs.length }) + (r.skipped ? t('import_skipped', { n: r.skipped }) : ''));
    };
    rd.readAsText(file);
  }

  // ---------- wiring ----------
  $('#subForm').addEventListener('submit', onSubmit);
  $('#cancelEditBtn').addEventListener('click', function () { setEditing(null); });
  $('#listBody').addEventListener('click', onListClick);
  $('#exportBtn').addEventListener('click', function () { download('subscriptions-' + today + '.json', L.exportJSON(store.subs), 'application/json'); });
  $('#importFile').addEventListener('change', onImport);
  $('#importLbl').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#importFile').click(); } });
  $('#icsAllBtn').addEventListener('click', function () {
    var evs = store.subs.filter(function (s) { return !s.paused; }).map(icsEvent);
    if (!evs.length) { flash('#dataMsg', t('ics_none')); return; }
    download(t('ics_all_file'), L.buildICS(evs), 'text/calendar;charset=utf-8');
  });
  $('#clearBtn').addEventListener('click', function () {
    if (!window.confirm(t('confirm_clear', { n: store.subs.length }))) return;
    store.subs = []; setEditing(null); save(); render(); flash('#dataMsg', t('cleared'));
  });
  $$('.lang button').forEach(function (b) {
    b.addEventListener('click', function () {
      lang = b.getAttribute('data-lang');
      store.settings.lang = lang; save();
      var u = new URL(location.href);
      u.searchParams.set('lang', lang);
      history.replaceState(null, '', u.pathname + u.search + u.hash);
      applyLang(); render();
    });
  });
  // other tabs editing the same list
  window.addEventListener('storage', function (e) { if (e.key === KEY) { store = load(); render(); } });

  $('#importLbl').tabIndex = 0;
  applyLang();
  fillForm(null);
  render();
  try { window.localStorage.setItem(KEY + '-probe', '1'); window.localStorage.removeItem(KEY + '-probe'); } catch (e) { storageOk = false; $('#storageWarn').hidden = false; }
})();
