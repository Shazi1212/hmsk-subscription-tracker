# Subscription Tracker

Subscriptions renew by themselves and the notice period is easy to miss: this tracker lists them, adds up what they cost, and tells you the last day to cancel each one.

**Use it free:** https://hmsk.life/tools/subscription-tracker/

## What it does

- Keeps a list of subscriptions and contracts: name, price, currency (EUR, GBP, USD, CHF), billing cycle (weekly to yearly), next renewal date, notice period, category, note.
- Adds them up per month and per year, per currency (never mixed), with a breakdown by category.
- Calculates the cancel-by date from the renewal date and the notice period (counted back from the end of the period, as in § 187 / § 188 BGB) and rolls past renewal dates forward.
- Sorts by the next deadline and highlights the ones due within 7 and 30 days; for a missed deadline it shows the next chance.
- Calendar reminders as .ics files (RFC 5545), one per subscription or all at once, with alerts 7 days before and on the day.
- "Cancel it" opens the hmsk.life Kündigung generator with the provider name and end date filled in.
- Stored only in your browser (localStorage), with JSON export and import. English and German (`?lang=de`).

## Quick start

It is a static page with no build step and no dependencies.

```sh
python3 -m http.server 8080 --directory public   # then open http://localhost:8080
```

Or copy the `public/` folder to any web server. Site links (tool page, imprint, Kündigung generator, email signup) point
to `https://hmsk.life`; change `siteBase` in `public/config.js` for your own copy.

## Tests

Dates, totals, import/export and the .ics generation live in `public/logic.js` (no DOM) and are tested with Node's
built-in test runner (Node 18+):

```sh
node --test tests/
```

The tests cover month-end clamping (31 Jan + 1 month = 28/29 Feb, no drift over many renewals), rolling past dates
forward, the cancel-by rule for day, week and month notice periods, status levels and the next chance after a missed
deadline, totals in integer cents per currency, validation, JSON round-trip and .ics validity (CRLF, 75-octet
folding without splitting UTF-8 characters, escaping, two alarms).

## Email reminders

From the second visit with a list, "Email me before my cancel-by dates" opens a small form (`public/email-moment.js`,
shared by the hmsk.life tools): you tick the dates to be reminded of and type a label for each, and only those dates
and labels are posted to `hmsk.life/email/subscribe.php`. The form lists exactly what will be sent before you submit
(double opt-in; each date is deleted once its reminder is sent). The list itself stays in the browser. That server side (signup, scheduler, mail) is part of the
hmsk.life site, not this repo; on a self-hosted copy the form still posts to hmsk.life unless you change `siteBase`.

Not legal advice: the cancel-by date comes from the dates you enter; your contract terms decide.

## License

MIT, see [LICENSE](LICENSE). Fonts: Newsreader and Public Sans (SIL Open Font License), in `public/fonts/`; the shared hmsk.life look is in `public/letterpress.css`.
