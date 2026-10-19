/* Subscription tracker: dates, totals, validation and calendar (.ics) export.
   No DOM access here, so the same file runs in the browser (window.SubTracker)
   and in Node for the tests (module.exports).

   Dates are plain YYYY-MM-DD strings (no time zones). A subscription:
   { id, name, price, currency, cycle, next, notice: { n, unit }, category, note }
     cycle  = 'weekly' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly'
     next   = the next renewal date you know of (the day a new period starts and you pay again)
     notice = notice period before the renewal; unit 'days' | 'weeks' | 'months'

   Cancel-by rule: the cancellation must arrive before the notice period starts, counted back
   from the end of the current period (the day before the renewal), as in § 187 / § 188 BGB:
     renewal 1 Jan, 1 month notice  -> period ends 31 Dec -> cancel by 30 Nov
     renewal 1 Jul, 3 months notice -> period ends 30 Jun -> cancel by 31 Mar
     renewal 1 Jan, 14 days notice  -> cancel by 17 Dec
   That is: cancelBy = renewal - notice - 1 day (end-of-month clamping: 31 May - 3 months = 28/29 Feb). */
(function (root) {
  'use strict';

  var CYCLES = { weekly: { days: 7 }, monthly: { months: 1 }, quarterly: { months: 3 }, 'half-yearly': { months: 6 }, yearly: { months: 12 } };
  var PER_YEAR = { weekly: 52, monthly: 12, quarterly: 4, 'half-yearly': 2, yearly: 1 };
  var UNITS = ['days', 'weeks', 'months'];
  var CURRENCIES = ['EUR', 'GBP', 'USD', 'CHF'];
  var CATEGORIES = ['streaming', 'music', 'software', 'cloud', 'mobile', 'internet', 'gym', 'insurance', 'news', 'gaming', 'other'];
  // Category -> contract type for the Kündigung generator (tool #12); everything else is 'other'.
  var KUENDIGUNG_TYPE = { streaming: 'streaming', music: 'streaming', gaming: 'streaming', mobile: 'mobile', internet: 'mobile', gym: 'gym', insurance: 'insurance' };
  var SOON_DAYS = 30;
  var URGENT_DAYS = 7;
  var FORMAT = 'hmsk-subscription-tracker';
  var VERSION = 1;
  var TOOL_URL = 'https://hmsk.life/tools/subscription-tracker/?utm_source=ics&utm_medium=calendar&utm_campaign=subscription-tracker-reminder';

  // ---------- dates ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function parse(s) {
    if (!isDate(s)) throw new Error('Bad date: ' + s);
    return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) };
  }
  function fromUTC(dt) { return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addDays(s, n) { var o = parse(s); return fromUTC(new Date(Date.UTC(o.y, o.m - 1, o.d + n))); }
  // Month arithmetic clamps to the last day of the month: 31 Jan + 1 month = 28/29 Feb.
  function addMonths(s, n) {
    var o = parse(s);
    var idx = o.y * 12 + (o.m - 1) + n;
    var y = Math.floor(idx / 12), m = idx - y * 12 + 1;
    return y + '-' + pad(m) + '-' + pad(Math.min(o.d, daysInMonth(y, m)));
  }
  function diffDays(a, b) { // b - a in days
    var x = parse(a), y = parse(b);
    return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86400000);
  }
  function todayISO(now) {
    now = now || new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  // k-th renewal after the anchor date, always computed from the anchor so month-end dates don't drift
  // (31 Jan -> 28 Feb -> 31 Mar, not 28 Mar).
  function nthRenewal(anchor, cycle, k) {
    var c = CYCLES[cycle];
    if (!c) throw new Error('Bad cycle: ' + cycle);
    return c.days ? addDays(anchor, c.days * k) : addMonths(anchor, c.months * k);
  }

  // The first renewal on or after `today` (subscriptions renew by themselves, so a past date rolls forward).
  function upcomingRenewal(next, cycle, today) {
    if (next >= today) return next;
    var c = CYCLES[cycle];
    // jump close to today first, then step, so 20-year-old weekly dates stay cheap
    var k = c.days ? Math.floor(diffDays(next, today) / c.days) : Math.max(0, Math.floor(diffDays(next, today) / 31 / c.months));
    var d = nthRenewal(next, cycle, k);
    while (d < today) { k++; d = nthRenewal(next, cycle, k); }
    return d;
  }

  function subtractNotice(date, notice) {
    var n = notice && +notice.n > 0 ? Math.floor(+notice.n) : 0;
    if (!n) return date;
    if (notice.unit === 'months') return addMonths(date, -n);
    if (notice.unit === 'weeks') return addDays(date, -7 * n);
    return addDays(date, -n);
  }

  // Last day the cancellation has to arrive to stop the renewal on `renewal`.
  function cancelBy(renewal, notice) { return addDays(subtractNotice(renewal, notice), -1); }

  /* schedule(sub, today) -> {
       renewal:     next renewal on or after today
       cancelBy:    last day to cancel before that renewal
       days:        days from today to cancelBy (negative = missed)
       status:      'missed' | 'urgent' | 'soon' | 'ok'
       nextChance:  when missed: { renewal, cancelBy, days } for the renewal after that
       periodEnd:   the day before the renewal (last day you have paid for)
     } */
  function schedule(sub, today) {
    today = today || todayISO();
    var renewal = upcomingRenewal(sub.next, sub.cycle, today);
    var cb = cancelBy(renewal, sub.notice);
    var days = diffDays(today, cb);
    var r = { renewal: renewal, cancelBy: cb, days: days, periodEnd: addDays(renewal, -1), nextChance: null };
    if (days < 0) {
      r.status = 'missed';
      // find the first later renewal whose cancel-by date is still ahead (a long notice can skip several)
      var k = 1, nr, ncb;
      do { nr = nthRenewal(renewal, sub.cycle, k++); ncb = cancelBy(nr, sub.notice); } while (ncb < today && k < 1000);
      r.nextChance = { renewal: nr, cancelBy: ncb, days: diffDays(today, ncb) };
    } else if (days <= URGENT_DAYS) r.status = 'urgent';
    else if (days <= SOON_DAYS) r.status = 'soon';
    else r.status = 'ok';
    return r;
  }

  // The deadline that still counts: this period's cancel-by date, or the next chance when it was missed.
  function activeDeadline(s) { return s.status === 'missed' ? s.nextChance : s; }

  // ---------- money (integer cents, so totals don't collect float noise) ----------
  function cents(x) { return Math.round(+x * 100); }
  function yearlyCents(sub) { return cents(sub.price) * PER_YEAR[sub.cycle]; }
  function monthlyCents(sub) { return Math.round(yearlyCents(sub) / 12); }

  /* totals(subs) -> { EUR: { monthly, yearly, count }, ... } in cents per currency (never mixed).
     Monthly is yearly / 12, rounded once, so 12 x monthly can differ from yearly by a few cents. */
  function totals(subs) {
    var out = {};
    (subs || []).forEach(function (s) {
      if (s.paused) return;
      var t = out[s.currency] || (out[s.currency] = { yearly: 0, monthly: 0, count: 0 });
      t.yearly += yearlyCents(s);
      t.count++;
    });
    Object.keys(out).forEach(function (c) { out[c].monthly = Math.round(out[c].yearly / 12); });
    return out;
  }

  // byCategory(subs, currency) -> [{ category, yearly }] largest first (cents).
  function byCategory(subs, currency) {
    var m = {};
    (subs || []).forEach(function (s) {
      if (s.paused || s.currency !== currency) return;
      m[s.category] = (m[s.category] || 0) + yearlyCents(s);
    });
    return Object.keys(m).map(function (k) { return { category: k, yearly: m[k] }; })
      .sort(function (a, b) { return b.yearly - a.yearly || (a.category < b.category ? -1 : 1); });
  }

  // Subscriptions with their schedule, soonest deadline first.
  function sorted(subs, today) {
    return (subs || []).map(function (s) { return { sub: s, sch: schedule(s, today) }; })
      .sort(function (a, b) {
        var da = activeDeadline(a.sch).cancelBy, db = activeDeadline(b.sch).cancelBy;
        return (a.sub.paused ? 1 : 0) - (b.sub.paused ? 1 : 0) || (da < db ? -1 : da > db ? 1 : 0) ||
          String(a.sub.name).localeCompare(String(b.sub.name));
      });
  }

  // ---------- validation, import, export ----------
  function uid() {
    var c = root.crypto || (typeof require === 'function' ? safeRequireCrypto() : null);
    if (c && c.randomUUID) return c.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function safeRequireCrypto() { try { return require('crypto'); } catch (e) { return null; } }

  /* normalize(raw) -> { sub, errors: [field, ...] }. Accepts prices as "9,99" or "9.99". */
  function normalize(raw) {
    raw = raw || {};
    var errors = [];
    var name = String(raw.name || '').trim().slice(0, 80);
    if (!name) errors.push('name');
    var price = typeof raw.price === 'number' ? raw.price : parseFloat(String(raw.price || '').replace(/\s/g, '').replace(',', '.'));
    if (!isFinite(price) || price < 0 || price > 1e7) errors.push('price');
    var cycle = CYCLES[raw.cycle] ? raw.cycle : null;
    if (!cycle) errors.push('cycle');
    var next = isDate(raw.next) ? raw.next : null;
    if (!next) errors.push('next');
    var nn = raw.notice && raw.notice.n !== '' && raw.notice.n != null ? +raw.notice.n : 0;
    var unit = raw.notice && UNITS.indexOf(raw.notice.unit) !== -1 ? raw.notice.unit : 'days';
    if (!isFinite(nn) || nn < 0 || nn > 3650 || Math.floor(nn) !== nn) errors.push('notice');
    var sub = {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : uid(),
      name: name,
      price: isFinite(price) ? Math.round(price * 100) / 100 : 0,
      currency: CURRENCIES.indexOf(raw.currency) !== -1 ? raw.currency : 'EUR',
      cycle: cycle || 'monthly',
      next: next || '',
      notice: { n: isFinite(nn) ? Math.max(0, Math.floor(nn)) : 0, unit: unit },
      category: CATEGORIES.indexOf(raw.category) !== -1 ? raw.category : 'other',
      note: String(raw.note || '').trim().slice(0, 300),
      paused: !!raw.paused,
    };
    return { sub: sub, errors: errors };
  }

  function exportJSON(subs, now) {
    return JSON.stringify({ format: FORMAT, version: VERSION, exported: (now || new Date()).toISOString(), subscriptions: subs }, null, 2);
  }

  /* importJSON(text) -> { subs, skipped } . Throws on a file that is not a backup of this tool.
     Accepts the export format or a bare array of subscriptions. */
  function importJSON(text) {
    var data = JSON.parse(text);
    var list = Array.isArray(data) ? data : data && data.format === FORMAT && Array.isArray(data.subscriptions) ? data.subscriptions : null;
    if (!list) throw new Error('not-a-backup');
    var subs = [], skipped = 0, seen = {};
    list.forEach(function (raw) {
      var r = normalize(raw);
      if (r.errors.length) { skipped++; return; }
      if (seen[r.sub.id]) r.sub.id = uid();
      seen[r.sub.id] = true;
      subs.push(r.sub);
    });
    return { subs: subs, skipped: skipped };
  }

  // ---------- iCalendar (RFC 5545) ----------
  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function utf8Len(ch) { var c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  // Fold lines longer than 75 octets (UTF-8), never splitting a character.
  function fold(line) {
    var out = [], cur = '', bytes = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i], code = line.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < line.length) ch += line[++i];
      var b = utf8Len(ch);
      if (bytes + b > 75) { out.push(cur); cur = ' ' + ch; bytes = 1 + b; } else { cur += ch; bytes += b; }
    }
    out.push(cur);
    return out.join('\r\n');
  }
  function stamp(now) {
    now = now || new Date();
    return now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' +
      pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
  }

  /* buildICS(events, now) -> calendar text with CRLF line ends.
     events: [{ uid, date, summary, description, url }]; each one is an all-day event with two display
     alarms: 7 days before at 09:00 and on the day at 09:00 (relative to the all-day start). */
  function buildICS(events, now) {
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//hmsk.life//Subscription Tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    events.forEach(function (ev) {
      lines.push('BEGIN:VEVENT', 'UID:' + ev.uid, 'DTSTAMP:' + stamp(now),
        'DTSTART;VALUE=DATE:' + ev.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + addDays(ev.date, 1).replace(/-/g, ''),
        'SUMMARY:' + icsEscape(ev.summary), 'DESCRIPTION:' + icsEscape(ev.description), 'URL:' + (ev.url || TOOL_URL),
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(ev.summary), 'TRIGGER;RELATED=START:-P6DT15H', 'END:VALARM',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(ev.summary), 'TRIGGER;RELATED=START:PT9H', 'END:VALARM',
        'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  // Stable per subscription and deadline, so importing the file again updates instead of duplicating.
  function eventUid(sub, date) { return 'sub-' + String(sub.id).replace(/[^A-Za-z0-9-]/g, '') + '-' + date.replace(/-/g, '') + '@hmsk.life'; }

  var api = {
    CYCLES: CYCLES, PER_YEAR: PER_YEAR, UNITS: UNITS, CURRENCIES: CURRENCIES, CATEGORIES: CATEGORIES,
    KUENDIGUNG_TYPE: KUENDIGUNG_TYPE, SOON_DAYS: SOON_DAYS, URGENT_DAYS: URGENT_DAYS, FORMAT: FORMAT, TOOL_URL: TOOL_URL,
    isDate: isDate, addDays: addDays, addMonths: addMonths, diffDays: diffDays, todayISO: todayISO,
    nthRenewal: nthRenewal, upcomingRenewal: upcomingRenewal, cancelBy: cancelBy, schedule: schedule,
    activeDeadline: activeDeadline, yearlyCents: yearlyCents, monthlyCents: monthlyCents, totals: totals,
    byCategory: byCategory, sorted: sorted, normalize: normalize, exportJSON: exportJSON, importJSON: importJSON,
    icsEscape: icsEscape, fold: fold, buildICS: buildICS, eventUid: eventUid,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SubTracker = api;
})(typeof window !== 'undefined' ? window : globalThis);
