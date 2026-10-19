'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/logic.js');

const sub = (o) => L.normalize(Object.assign({ name: 'Test', price: 10, currency: 'EUR', cycle: 'monthly', next: '2027-01-01', notice: { n: 0, unit: 'days' } }, o)).sub;

test('month arithmetic clamps to the end of the month', () => {
  assert.equal(L.addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(L.addMonths('2028-01-31', 1), '2028-02-29'); // leap year
  assert.equal(L.addMonths('2027-05-31', -3), '2027-02-28');
  assert.equal(L.addMonths('2027-03-15', -15), '2025-12-15');
  assert.equal(L.addMonths('2027-12-10', 1), '2028-01-10');
  assert.equal(L.addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(L.diffDays('2026-10-19', '2027-01-01'), 74);
  assert.ok(L.isDate('2028-02-29'));
  assert.ok(!L.isDate('2027-02-29'));
  assert.ok(!L.isDate('2027-1-01'));
});

test('renewals are computed from the anchor, so month ends do not drift', () => {
  assert.equal(L.nthRenewal('2027-01-31', 'monthly', 1), '2027-02-28');
  assert.equal(L.nthRenewal('2027-01-31', 'monthly', 2), '2027-03-31');
  assert.equal(L.nthRenewal('2027-01-31', 'quarterly', 1), '2027-04-30');
  assert.equal(L.nthRenewal('2028-02-29', 'yearly', 1), '2029-02-28');
  assert.equal(L.nthRenewal('2027-01-01', 'weekly', 3), '2027-01-22');
  assert.equal(L.nthRenewal('2027-01-15', 'half-yearly', 1), '2027-07-15');
});

test('a renewal date in the past rolls forward to the next one', () => {
  assert.equal(L.upcomingRenewal('2026-01-31', 'monthly', '2026-10-19'), '2026-10-31');
  assert.equal(L.upcomingRenewal('2026-10-19', 'monthly', '2026-10-19'), '2026-10-19'); // today counts
  assert.equal(L.upcomingRenewal('2020-03-01', 'yearly', '2026-10-19'), '2027-03-01');
  assert.equal(L.upcomingRenewal('2006-10-20', 'weekly', '2026-10-19'), '2026-10-23'); // Friday to Friday, 20 years on
  assert.equal(L.upcomingRenewal('2027-05-01', 'monthly', '2026-10-19'), '2027-05-01'); // future stays
});

test('cancel-by date: notice counted back from the end of the period', () => {
  // renewal 1 Jan, period ends 31 Dec
  assert.equal(L.cancelBy('2027-01-01', { n: 1, unit: 'months' }), '2026-11-30');
  assert.equal(L.cancelBy('2027-07-01', { n: 3, unit: 'months' }), '2027-03-31');
  assert.equal(L.cancelBy('2027-01-01', { n: 14, unit: 'days' }), '2026-12-17');
  assert.equal(L.cancelBy('2027-01-01', { n: 2, unit: 'weeks' }), '2026-12-17');
  assert.equal(L.cancelBy('2027-01-01', { n: 0, unit: 'days' }), '2026-12-31'); // no notice: by the last paid day
  assert.equal(L.cancelBy('2027-06-01', { n: 3, unit: 'months' }), '2027-02-28');
  assert.equal(L.cancelBy('2027-03-31', { n: 1, unit: 'months' }), '2027-02-27');
});

test('schedule: status levels and the next chance after a missed deadline', () => {
  const today = '2026-10-19';
  const at = (next, notice) => L.schedule(sub({ next, notice }), today);
  assert.equal(at('2027-06-01', { n: 1, unit: 'months' }).status, 'ok');
  let s = at('2026-11-30', { n: 14, unit: 'days' }); // cancel by 15 Nov = 27 days
  assert.equal(s.cancelBy, '2026-11-15'); assert.equal(s.days, 27); assert.equal(s.status, 'soon');
  s = at('2026-10-27', { n: 0, unit: 'days' }); // cancel by 26 Oct = 7 days
  assert.equal(s.days, 7); assert.equal(s.status, 'urgent');
  s = at('2026-10-20', { n: 0, unit: 'days' }); // cancel by today
  assert.equal(s.cancelBy, today); assert.equal(s.days, 0); assert.equal(s.status, 'urgent');
  s = at('2026-11-01', { n: 1, unit: 'months' }); // cancel by 30 Sep: missed
  assert.equal(s.status, 'missed'); assert.equal(s.days, -19);
  assert.deepEqual(s.nextChance, { renewal: '2026-12-01', cancelBy: '2026-10-31', days: 12 });
  assert.equal(L.activeDeadline(s).cancelBy, '2026-10-31');
  assert.equal(s.periodEnd, '2026-10-31');
  // long notice on a monthly plan skips several renewals
  s = at('2026-11-01', { n: 3, unit: 'months' }); // 31 Jul missed; Dec->31 Aug, Jan->30 Sep, Feb->31 Oct
  assert.equal(s.nextChance.renewal, '2027-02-01'); assert.equal(s.nextChance.cancelBy, '2026-10-31');
  // yearly contract, renewal in the past rolls forward first
  s = L.schedule(sub({ cycle: 'yearly', next: '2025-03-01', notice: { n: 3, unit: 'months' } }), today);
  assert.equal(s.renewal, '2027-03-01'); assert.equal(s.cancelBy, '2026-11-30'); assert.equal(s.status, 'ok');
});

test('totals per currency, monthly and yearly, in cents', () => {
  const subs = [
    sub({ price: 9.99, cycle: 'monthly' }),
    sub({ price: 120, cycle: 'yearly' }),
    sub({ price: 3, cycle: 'weekly' }),
    sub({ price: 30, cycle: 'quarterly' }),
    sub({ price: 60, cycle: 'half-yearly' }),
    sub({ price: '10,50', currency: 'GBP', cycle: 'monthly' }),
    sub({ price: 99, cycle: 'monthly', paused: true }),
  ];
  const t = L.totals(subs);
  assert.equal(t.EUR.yearly, 11988 + 12000 + 15600 + 12000 + 12000); // 635.88
  assert.equal(t.EUR.monthly, Math.round(63588 / 12)); // 52.99
  assert.equal(t.EUR.count, 5);
  assert.deepEqual(t.GBP, { yearly: 12600, monthly: 1050, count: 1 });
  assert.equal(t.USD, undefined);
  assert.equal(L.monthlyCents(sub({ price: 3, cycle: 'weekly' })), 1300);
  // 0.1 + 0.2 style float noise does not show up
  assert.equal(L.totals([sub({ price: 0.1 }), sub({ price: 0.2 })]).EUR.yearly, 360);
});

test('category breakdown is largest first and per currency', () => {
  const subs = [sub({ category: 'streaming', price: 10 }), sub({ category: 'gym', price: 30 }), sub({ category: 'streaming', price: 5 }), sub({ category: 'gym', currency: 'USD', price: 100 })];
  assert.deepEqual(L.byCategory(subs, 'EUR'), [{ category: 'gym', yearly: 36000 }, { category: 'streaming', yearly: 18000 }]);
});

test('sorted puts the soonest active deadline first and paused ones last', () => {
  const today = '2026-10-19';
  const a = sub({ name: 'A', next: '2027-05-01' }), b = sub({ name: 'B', next: '2026-11-01' }), c = sub({ name: 'C', next: '2026-10-25', paused: true });
  assert.deepEqual(L.sorted([a, b, c], today).map((x) => x.sub.name), ['B', 'A', 'C']);
});

test('normalize validates input and keeps only known values', () => {
  let r = L.normalize({ name: '  Netflix ', price: '12,99', cycle: 'monthly', next: '2026-11-03', notice: { n: '1', unit: 'months' }, category: 'streaming', currency: 'EUR' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.sub.name, 'Netflix'); assert.equal(r.sub.price, 12.99); assert.deepEqual(r.sub.notice, { n: 1, unit: 'months' });
  r = L.normalize({ name: '', price: '-1', cycle: 'daily', next: '2027-02-30', notice: { n: 1.5, unit: 'years' } });
  assert.deepEqual(r.errors.sort(), ['cycle', 'name', 'next', 'notice', 'price']);
  r = L.normalize({ name: 'X', price: 1, cycle: 'yearly', next: '2027-01-01', category: 'nope', currency: 'JPY' });
  assert.equal(r.sub.category, 'other'); assert.equal(r.sub.currency, 'EUR'); assert.deepEqual(r.sub.notice, { n: 0, unit: 'days' });
});

test('JSON export and import round-trip, bad files are rejected', () => {
  const subs = [sub({ name: 'One', id: 'a' }), sub({ name: 'Two', id: 'b', note: 'family plan' })];
  const text = L.exportJSON(subs, new Date('2026-10-19T10:00:00Z'));
  const back = L.importJSON(text);
  assert.deepEqual(back.subs, subs); assert.equal(back.skipped, 0);
  assert.throws(() => L.importJSON('{"foo":1}'), /not-a-backup/);
  assert.throws(() => L.importJSON('not json'));
  const mixed = L.importJSON(JSON.stringify([{ name: 'ok', price: 1, cycle: 'monthly', next: '2027-01-01', id: 'x' }, { name: '' }, { name: 'dup', price: 2, cycle: 'yearly', next: '2027-01-01', id: 'x' }]));
  assert.equal(mixed.subs.length, 2); assert.equal(mixed.skipped, 1);
  assert.notEqual(mixed.subs[0].id, mixed.subs[1].id);
});

test('ics: valid structure, two alarms, folding without splitting UTF-8', () => {
  const s = sub({ id: 'abc-123', name: 'Fitnessstudio Müller; Premium, Plus' });
  const ics = L.buildICS([{ uid: L.eventUid(s, '2026-11-30'), date: '2026-11-30', summary: 'Kündigen: ' + s.name, description: 'Kündigung muss bis 30. November ankommen.\nZweite Zeile ' + 'ä'.repeat(60) }], new Date('2026-10-19T08:05:09Z'));
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'only CRLF line ends');
  const lines = ics.split('\r\n');
  for (const l of lines) assert.ok(Buffer.byteLength(l, 'utf8') <= 75, 'line too long: ' + l);
  assert.ok(!ics.includes('�'));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /UID:sub-abc-123-20261130@hmsk\.life/);
  assert.match(unfolded, /DTSTAMP:20261019T080509Z/);
  assert.match(unfolded, /DTSTART;VALUE=DATE:20261130\r\nDTEND;VALUE=DATE:20261201/);
  assert.match(unfolded, /SUMMARY:Kündigen: Fitnessstudio Müller\\; Premium\\, Plus/);
  assert.match(unfolded, /\\nZweite Zeile ä{60}/);
  assert.equal((unfolded.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.match(unfolded, /TRIGGER;RELATED=START:-P6DT15H/); // 7 days before at 09:00
  assert.match(unfolded, /TRIGGER;RELATED=START:PT9H/);
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(unfolded.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  const two = L.buildICS([{ uid: 'a@x', date: '2026-12-01', summary: 'a', description: '' }, { uid: 'b@x', date: '2027-01-01', summary: 'b', description: '' }]);
  assert.equal((two.match(/BEGIN:VEVENT/g) || []).length, 2);
});
