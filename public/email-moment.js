/* email-moment.js: the in-app email signup of the hmsk.life tools (double opt-in on hmsk.life/email/subscribe.php).
   Same file in every tool repo (public/email-moment.js); the master copy is HMSK-Tools/_letterpress/email-moment.js.
   Rules (hmsk.life docs/VISION.md): offered at the second use, never before the first result; one optional question;
   the consent text says exactly what gets sent; only the email address, the topic and the dates the person picks
   (with a label they can edit) leave the browser. The box shows that list live before anything is sent.
   The consent texts below must match hmsk.life src/signup.py (tests/email/test_email.py checks it); the server stores
   its own copy of the text, never the one from the request.

   HMSKMoment.use(key)    call once when the tool shows a result; counts sessions (not page renders). Returns the count.
   HMSKMoment.uses(key)   the count without adding one.
   HMSKMoment.render(el, opts)   draws the form into el (call again after a language switch; typed values are kept).
     opts: lang 'en'|'de', action (full URL of /email/subscribe.php), privacy (URL of the privacy policy section),
           topic, topicName, source ('/apps/<slug>/'), title, intro,
           items [{ date: 'YYYY-MM-DD', label, hint, kind: 'deadline'|'renewal'|'cancel', text, checked, key }] (optional;
           label = prefilled label, hint = placeholder when the person should type the label themselves),
           pick: true = checkboxes per item (else every item is sent), leads: [1, 3, 7, 14, 30] = let the person pick
           the days before (else the server's fixed lead for the topic applies), consent: 'topic'|'reminders'|'own'. */
(function () {
  'use strict';

  var CONSENT = /*CONSENT*/{
    "topic": {
      "en": "I agree that Hafiz Khalid (hmsk.life) emails me about the topic above. I confirm with the link in the first email. I can unsubscribe at any time with the link in every email. Privacy policy: hmsk.life/privacy/#newsletter",
      "de": "Ich bin einverstanden, dass Hafiz Khalid (hmsk.life) mir E-Mails zum oben genannten Thema schickt. Ich bestätige mit dem Link in der ersten E-Mail. Abmelden kann ich mich jederzeit über den Link in jeder E-Mail. Datenschutz: hmsk.life/datenschutz/#newsletter"
    },
    "reminders": {
      "en": "I agree that Hafiz Khalid (hmsk.life) stores my email address and the dates I ticked with their labels, and emails me a reminder before each date. I confirm with the link in the first email. I can unsubscribe and delete the dates at any time with the link in every email. Privacy policy: hmsk.life/privacy/#newsletter",
      "de": "Ich bin einverstanden, dass Hafiz Khalid (hmsk.life) meine E-Mail-Adresse und die angehakten Termine mit ihren Bezeichnungen speichert und mich vor jedem Termin per E-Mail erinnert. Ich bestätige mit dem Link in der ersten E-Mail. Abmelden und die Termine löschen kann ich jederzeit über den Link in jeder E-Mail. Datenschutz: hmsk.life/datenschutz/#newsletter"
    },
    "own": {
      "e-invoice-reminder": {
        "en": "I agree that Hafiz Khalid (hmsk.life) stores my email address and my e-invoicing deadline with its label, emails me a reminder three months before it, and emails me when the rules change. I confirm with the link in the first email. I can unsubscribe and delete the date at any time with the link in every email. Privacy policy: hmsk.life/privacy/#newsletter",
        "de": "Ich bin einverstanden, dass Hafiz Khalid (hmsk.life) meine E-Mail-Adresse und meine E-Rechnungs-Frist mit ihrer Bezeichnung speichert, mich drei Monate vorher per E-Mail erinnert und mir schreibt, wenn sich die Regeln ändern. Ich bestätige mit dem Link in der ersten E-Mail. Abmelden und den Termin löschen kann ich jederzeit über den Link in jeder E-Mail. Datenschutz: hmsk.life/datenschutz/#newsletter"
      },
      "habit-weekly": {
        "en": "I agree that Hafiz Khalid (hmsk.life) stores my email address and the start date shown, and emails me once a week on that weekday to open my week summary in the habit tracker. My habits stay in my browser and are not sent. I confirm with the link in the first email. I can unsubscribe and delete the date at any time with the link in every email. Privacy policy: hmsk.life/privacy/#newsletter",
        "de": "Ich bin einverstanden, dass Hafiz Khalid (hmsk.life) meine E-Mail-Adresse und das angezeigte Startdatum speichert und mich einmal pro Woche an diesem Wochentag per E-Mail an meinen Wochenrückblick im Habit-Tracker erinnert. Meine Gewohnheiten bleiben in meinem Browser und werden nicht übertragen. Ich bestätige mit dem Link in der ersten E-Mail. Abmelden und den Termin löschen kann ich jederzeit über den Link in jeder E-Mail. Datenschutz: hmsk.life/datenschutz/#newsletter"
      },
      "kleinunternehmer-monthly": {
        "en": "I agree that Hafiz Khalid (hmsk.life) stores my email address and the start date shown, and emails me on the 1st of each month to enter last month's turnover in the Kleinunternehmer check, which warns me before I reach the limit. My figures stay in my browser and are not sent. I confirm with the link in the first email. I can unsubscribe and delete the date at any time with the link in every email. Privacy policy: hmsk.life/privacy/#newsletter",
        "de": "Ich bin einverstanden, dass Hafiz Khalid (hmsk.life) meine E-Mail-Adresse und das angezeigte Startdatum speichert und mich am 1. jedes Monats per E-Mail erinnert, den Umsatz des Vormonats in den Kleinunternehmer-Check einzutragen, der mich warnt, bevor ich die Grenze erreiche. Meine Zahlen bleiben in meinem Browser und werden nicht übertragen. Ich bestätige mit dem Link in der ersten E-Mail. Abmelden und den Termin löschen kann ich jederzeit über den Link in jeder E-Mail. Datenschutz: hmsk.life/datenschutz/#newsletter"
      }
    }
  }/*END*/;

  // The one optional question (keys = hmsk.life src/signup.py ANSWERS).
  var ANSWERS = ['freelancer', 'small-business', 'employee', 'private', 'other'];

  var T = {
    en: {
      email: 'Email', email_ph: 'your@email.com', q: 'What do you use it for?', q_hint: '(optional, helps me decide what to build)',
      q_none: 'Rather not say', freelancer: 'Freelance / self-employed work', 'small-business': 'My small business',
      employee: 'My job (employed)', private: 'Private life', other: 'Something else',
      topic: 'Topic', label: 'Label (you can change it)', lead: 'Days before the date', submit: 'Send confirmation email',
      sent_h: 'Exactly what is sent to hmsk.life', s_email: 'Your email address', s_email_none: '(not typed yet)',
      s_topic: 'Topic', s_date: 'Date', s_lead: 'Days before', s_answer: 'Your answer', s_lang: 'Language', lang_name: 'English',
      s_nothing: 'Nothing else from this tool leaves your browser.', s_none: '(no date ticked yet)',
      doi: 'Double opt-in: nothing is stored for good and nothing is sent until you click the link in the confirmation email.',
      tick: 'Tick at least one date.', q1: '&ldquo;', q2: '&rdquo;', need_label: 'Give each ticked date a label.'
    },
    de: {
      email: 'E-Mail', email_ph: 'ihre@email.de', q: 'Wofür nutzen Sie es?', q_hint: '(optional, hilft mir zu entscheiden, was ich baue)',
      q_none: 'Keine Angabe', freelancer: 'Freiberuflich / selbstständig', 'small-business': 'Mein kleines Unternehmen',
      employee: 'Meinen Job (angestellt)', private: 'Privat', other: 'Etwas anderes',
      topic: 'Thema', label: 'Bezeichnung (änderbar)', lead: 'Tage vor dem Termin', submit: 'Bestätigungs-E-Mail senden',
      sent_h: 'Genau das wird an hmsk.life gesendet', s_email: 'Ihre E-Mail-Adresse', s_email_none: '(noch nicht eingegeben)',
      s_topic: 'Thema', s_date: 'Termin', s_lead: 'Tage vorher', s_answer: 'Ihre Antwort', s_lang: 'Sprache', lang_name: 'Deutsch',
      s_nothing: 'Sonst verlässt nichts aus diesem Tool Ihren Browser.', s_none: '(noch kein Termin angehakt)',
      doi: 'Double-Opt-in: Erst wenn Sie den Link in der Bestätigungs-E-Mail klicken, wird etwas dauerhaft gespeichert oder verschickt.',
      tick: 'Bitte mindestens einen Termin anhaken.', q1: '&bdquo;', q2: '&ldquo;', need_label: 'Bitte jedem angehakten Termin eine Bezeichnung geben.'
    }
  };

  var CSS = '.em{border:1px solid var(--rule,#CBD2D9);border-radius:var(--radius,6px);background:var(--card,#F8F9FA);padding:16px;margin:16px 0;max-width:720px;text-align:left}' +
    '.em__h{font:600 17px/1.3 var(--sans,system-ui,sans-serif);margin:0 0 4px;color:var(--ink,#151B24)}' +
    '.em p{margin:0 0 10px}.em__s{font-size:14px;color:var(--ink-2,#4A5562)}' +
    '.em__f{display:block;margin:0 0 12px}.em__f>span{display:block;font-size:14px;margin-bottom:4px;color:var(--ink,#151B24)}' +
    '.em__f input,.em__f select{width:100%;max-width:420px;min-height:40px;padding:6px 10px;font-size:16px;box-sizing:border-box}' +
    '.em__c{display:flex;gap:8px;align-items:flex-start;margin:0 0 10px;font-size:14px;line-height:1.45}.em__c input{margin-top:3px;flex:none}' +
    '.em__c a{color:var(--accent,#1E4C8A)}' +
    '.em__item{border-top:1px solid var(--rule,#CBD2D9);padding:8px 0}.em__item .em__f{margin:6px 0 0}.em__item--pick .em__f{margin-left:26px}' +
    '.em__sent{border-left:3px solid var(--accent,#1E4C8A);background:var(--paper,#EFF1F2);padding:10px 12px;margin:0 0 12px;font-size:14px}' +
    '.em__sent>b{display:block;margin-bottom:4px}.em__sent ul{margin:0;padding-left:18px}.em__sent li{margin:2px 0;overflow-wrap:anywhere}' +
    '.em [hidden]{display:none!important}.em__hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}' +
    '.em__msg{font-size:14px;color:var(--danger,#A3262A);min-height:1em}' +
    '.em__btn{font:600 16px/1 var(--sans,system-ui,sans-serif);background:var(--accent,#1E4C8A);color:var(--on-accent,#fff);border:0;border-radius:var(--r-sm,3px);padding:12px 18px;min-height:44px;cursor:pointer}' +
    '.em__btn:hover{background:var(--accent-hover,#163A6B)}@media print{.em{display:none!important}}';

  var memo = {}; // typed values per topic, so a re-render (language switch, result update) keeps them

  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function uses(key) { return parseInt(store('hmsk.uses.' + key), 10) || 0; }
  function use(key) {
    var n = uses(key), flag = 'hmsk.used.' + key;
    try { if (sessionStorage.getItem(flag)) return n; sessionStorage.setItem(flag, '1'); } catch (e) { return n + 1; }
    store('hmsk.uses.' + key, String(n + 1));
    return n + 1;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function key(it) { return it.key || it.date + it.kind; }
  function consentText(o) {
    if (o.consent === 'own') return CONSENT.own[o.topic][o.lang];
    return CONSENT[o.consent || 'topic'][o.lang];
  }

  function render(el, o) {
    if (!el) return;
    if (!document.getElementById('em-style')) {
      var st = document.createElement('style');
      st.id = 'em-style'; st.textContent = CSS; document.head.appendChild(st);
    }
    var t = T[o.lang] || T.en, items = o.items || [], m = memo[o.topic] || (memo[o.topic] = { labels: {}, on: {} });
    var uid = 'em-' + o.topic;
    var ref = o.lang === 'de' ? 'hmsk.life/datenschutz/#newsletter' : 'hmsk.life/privacy/#newsletter';
    var consent = esc(consentText(o)).replace(ref, '<a href="' + esc(o.privacy) + '" target="_blank" rel="noopener">' + ref + '</a>');
    var html = '<form class="em" method="POST" action="' + esc(o.action) + '" novalidate>' +
      '<p class="em__h">' + esc(o.title) + '</p>' + (o.intro ? '<p class="em__s">' + esc(o.intro) + '</p>' : '') +
      '<input type="hidden" name="lang" value="' + esc(o.lang) + '"><input type="hidden" name="topic" value="' + esc(o.topic) + '">' +
      '<input type="hidden" name="source" value="' + esc(o.source) + '"><input type="hidden" name="ctx" value="app">' +
      '<div class="em__hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<p class="em__s">' + esc(t.topic) + ': <b>' + esc(o.topicName) + '</b></p>';
    items.forEach(function (it, i) {
      var k = key(it);
      var on = o.pick ? (m.on[k] !== undefined ? m.on[k] : !!it.checked) : true;
      var lbl = m.labels[k] !== undefined ? m.labels[k] : (it.label || '');
      html += '<div class="em__item' + (o.pick ? ' em__item--pick' : '') + '">' +
        (o.pick ? '<label class="em__c"><input type="checkbox" data-em-on="' + i + '"' + (on ? ' checked' : '') + '> <span>' + esc(it.text) + '</span></label>'
          : '<p class="em__s" style="margin:0">' + esc(it.text) + '</p>') +
        '<label class="em__f" data-em-wrap="' + i + '"' + (on ? '' : ' hidden') + '><span>' + esc(t.label) + '</span><input type="text" maxlength="80" data-em-label="' + i + '" value="' + esc(lbl) + '"' + (it.hint ? ' placeholder="' + esc(it.hint) + '"' : '') + '></label></div>';
    });
    if (o.leads) {
      html += '<label class="em__f"><span>' + esc(t.lead) + '</span><select name="lead">' + o.leads.map(function (d) {
        return '<option value="' + d + '"' + (String(d) === String(m.lead || 7) ? ' selected' : '') + '>' + d + '</option>';
      }).join('') + '</select></label>';
    }
    html += '<label class="em__f"><span>' + esc(t.email) + '</span><input type="email" name="email" id="' + uid + '-email" required autocomplete="email" placeholder="' + esc(t.email_ph) + '" value="' + esc(m.email || '') + '"></label>' +
      '<label class="em__f"><span>' + esc(t.q) + ' <span class="em__s">' + esc(t.q_hint) + '</span></span><select name="answer"><option value="">' + esc(t.q_none) + '</option>' +
      ANSWERS.map(function (a) { return '<option value="' + a + '"' + (m.answer === a ? ' selected' : '') + '>' + esc(t[a]) + '</option>'; }).join('') + '</select></label>' +
      '<div class="em__sent" aria-live="polite"><b>' + esc(t.sent_h) + '</b><ul data-em-sent></ul><p class="em__s" style="margin:6px 0 0">' + esc(t.s_nothing) + '</p></div>' +
      '<label class="em__c"><input type="checkbox" name="consent" value="1" required' + (m.consent ? ' checked' : '') + '> <span>' + consent + '</span></label>' +
      '<p class="em__s">' + esc(t.doi) + '</p>' +
      '<button type="submit" class="em__btn">' + esc(t.submit) + '</button> <p class="em__msg" role="status" data-em-msg></p></form>';
    el.innerHTML = html;
    var f = el.querySelector('form');

    function picked() {
      return items.map(function (it, i) {
        var on = o.pick ? f.querySelector('[data-em-on="' + i + '"]').checked : true;
        var label = f.querySelector('[data-em-label="' + i + '"]').value.replace(/\s+/g, ' ').trim();
        return { on: on, it: it, label: label };
      }).filter(function (p) { return p.on; });
    }
    function sync() {
      m.email = f.email.value; m.answer = f.answer.value; m.consent = f.consent.checked;
      if (f.lead) m.lead = f.lead.value;
      items.forEach(function (it, i) {
        m.labels[key(it)] = f.querySelector('[data-em-label="' + i + '"]').value;
        if (o.pick) {
          m.on[key(it)] = f.querySelector('[data-em-on="' + i + '"]').checked;
          f.querySelector('[data-em-wrap="' + i + '"]').hidden = !m.on[key(it)]; // label field only for ticked dates
        }
      });
      var li = ['<li>' + esc(t.s_email) + ': ' + (f.email.value.trim() ? '<b>' + esc(f.email.value.trim()) + '</b>' : esc(t.s_email_none)) + '</li>',
        '<li>' + esc(t.s_topic) + ': ' + esc(o.topicName) + '</li>'];
      var p = picked();
      if (items.length) {
        if (!p.length) li.push('<li>' + esc(t.s_date) + ': ' + esc(t.s_none) + '</li>');
        p.forEach(function (x) { li.push('<li>' + esc(t.s_date) + ': <b>' + esc(x.it.date) + '</b>, ' + t.q1 + esc(x.label) + t.q2 + '</li>'); });
        if (f.lead) li.push('<li>' + esc(t.s_lead) + ': ' + esc(f.lead.value) + '</li>');
      }
      if (f.answer.value) li.push('<li>' + esc(t.s_answer) + ': ' + esc(t[f.answer.value]) + '</li>');
      li.push('<li>' + esc(t.s_lang) + ': ' + esc(t.lang_name) + '</li>');
      f.querySelector('[data-em-sent]').innerHTML = li.join('');
    }
    // Keep the tool's own listeners (re-render on input) out of this form.
    ['input', 'change', 'keydown', 'keyup', 'click'].forEach(function (ev) {
      f.addEventListener(ev, function (e) { e.stopPropagation(); if (ev === 'input' || ev === 'change') sync(); });
    });
    f.addEventListener('submit', function (e) {
      var msg = f.querySelector('[data-em-msg]');
      Array.prototype.forEach.call(f.querySelectorAll('input[data-gen]'), function (i) { i.remove(); });
      var p = picked();
      var bad = !f.email.checkValidity() ? f.email : !f.consent.checked ? f.consent : null;
      if (items.length && !p.length) { e.preventDefault(); msg.textContent = t.tick; return; }
      if (p.some(function (x) { return !x.label; })) { e.preventDefault(); msg.textContent = t.need_label; return; }
      if (bad) { e.preventDefault(); if (bad.reportValidity) bad.reportValidity(); bad.focus(); return; }
      p.forEach(function (x, i) {
        [['on', '1'], ['kind', x.it.kind || 'deadline'], ['date', x.it.date], ['label', x.label]].forEach(function (kv) {
          var h = document.createElement('input');
          h.type = 'hidden'; h.name = 'rem[' + i + '][' + kv[0] + ']'; h.value = kv[1]; h.setAttribute('data-gen', '');
          f.appendChild(h);
        });
      });
    });
    sync();
  }

  window.HMSKMoment = { render: render, use: use, uses: uses };
})();
