// ==UserScript==
// @name         Farla 08 - Website Order Summary
// @namespace    farla-office-scripts
// @version      1.2.0
// @description  Turns the website's ORDER DATA notes on a TradePeg sales order into a summary box
// @match        https://farla2.tradepeg.net/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/08.user.js
// @downloadURL  https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/08.user.js
// ==/UserScript==

// The website writes each order into the SO's notes as "[1/2] ORDER DATA {json…",
// "[2/2] …rest of json". This joins the parts, reads the JSON and shows it as a
// box under the Notes. The raw parts are folded down to one line in the notes.
// Every field in the JSON is shown somewhere: anything the layout below doesn't
// use lands in "Other fields", so new website fields never go missing.
(function () {
  'use strict';

  const BOX_ID = 'farla08-web-order';
  const PART_RE = /^\[(\d+)\/(\d+)\]\s?/;

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function addStyle() {
    if (document.getElementById(BOX_ID + '-css')) return;
    const css = document.createElement('style');
    css.id = BOX_ID + '-css';
    const B = '#' + BOX_ID;
    css.textContent = `
${B}{margin-top:12px}
${B} .panel-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
${B} .panel-body{padding:0;font-size:12px;line-height:1.5;color:#0f172a;background:#fff}
${B} .f8-pills{display:flex;gap:4px;flex-wrap:wrap}
${B} .f8-pill{font-size:10.5px;font-weight:600;border-radius:999px;padding:1px 8px;background:#e2e8f0;color:#334155;white-space:nowrap}
${B} .f8-pill.ok{background:#dcfce7;color:#166534}
${B} .f8-pill.warn{background:#fef3c7;color:#92400e}
${B} .f8-pill.bad{background:#fee2e2;color:#991b1b}
${B} .f8-hero{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;padding:12px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
${B} .f8-ref{font:600 12.5px/1.3 Consolas,"Courier New",monospace;word-break:break-all}
${B} .f8-when{color:#475569;font-size:11px;margin-top:2px}
${B} .f8-total{text-align:right;white-space:nowrap}
${B} .f8-total b{display:block;font-size:18px;line-height:1.1}
${B} .f8-total span{color:#475569;font-size:11px}
${B} .f8-copy{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:4px;font-size:10.5px;padding:0 6px;margin-left:6px;cursor:pointer;vertical-align:1px;transition:background .15s}
${B} .f8-copy:hover{background:#f1f5f9}
${B} .f8-copy:focus-visible,${B} summary:focus-visible,${B} a:focus-visible{outline:2px solid #0369a1;outline-offset:2px}
${B} .f8-sec{padding:10px 14px;border-bottom:1px solid #e2e8f0}
${B} .f8-sec:last-child{border-bottom:0}
${B} .f8-h{font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#475569;margin-bottom:6px;display:flex;justify-content:space-between}
${B} .f8-h small{font-weight:400;letter-spacing:0;text-transform:none}
${B} dl{display:grid;grid-template-columns:104px 1fr;gap:3px 10px;margin:0}
${B} dt{color:#475569;font-weight:400}
${B} dd{margin:0;font-weight:600;word-break:break-word}
${B} dd .f8-m{font-weight:400;color:#475569}
${B} .f8-m{color:#475569}
${B} .f8-mono{font-family:Consolas,"Courier New",monospace;font-size:11.5px}
${B} .f8-line{padding:7px 0;border-top:1px dashed #e2e8f0}
${B} .f8-line:first-of-type{border-top:0;padding-top:0}
${B} .f8-row{display:flex;justify-content:space-between;gap:10px}
${B} .f8-sku{font-weight:700;font-family:Consolas,"Courier New",monospace;font-size:12px}
${B} .f8-tags{margin-top:3px;display:flex;gap:4px;flex-wrap:wrap}
${B} .f8-tag{font-size:10.5px;background:#f1f5f9;color:#334155;border-radius:3px;padding:0 5px}
${B} .f8-tag.due{background:#e0f2fe;color:#075985}
${B} .f8-ship{background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:5px 8px;margin-top:6px}
${B} .f8-sums div{display:flex;justify-content:space-between;padding:1px 0;color:#334155}
${B} .f8-sums .f8-grand{font-weight:700;font-size:13.5px;color:#0f172a;border-top:1px solid #e2e8f0;margin-top:4px;padding-top:5px}
${B} .f8-addr{display:grid;grid-template-columns:1fr 1fr;gap:10px}
${B} .f8-addr > div{background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:6px 8px}
${B} .f8-addr .f8-h{margin-bottom:3px}
${B} .f8-note{background:#fffbeb;border:1px solid #fde68a;border-radius:4px;padding:6px 8px;margin-top:4px}
${B} details summary{cursor:pointer;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#475569}
${B} details[open] summary{margin-bottom:6px}
${B} a{color:#0369a1}
.farla08-folded{color:#64748b;font-style:italic;cursor:pointer}
.farla08-folded:hover{color:#0f172a}
`;
    document.head.appendChild(css);
  }

  function isSalesOrderPage() {
    return /\/doc\/so\/\d+/i.test(location.pathname);
  }

  // Note text without the "API  27/10/2026 18:17:25" header row.
  function noteText(area) {
    const copy = area.cloneNode(true);
    copy.querySelectorAll('.infoRow, .farla08-folded').forEach((n) => n.remove());
    return copy.textContent.trim();
  }

  function readNotes() {
    const areas = Array.from(document.querySelectorAll('#notes-container .messageArea'));
    const notes = areas.map((area) => ({ area, text: area.dataset.farla08Raw || noteText(area) }));
    notes.forEach((n) => { n.area.dataset.farla08Raw = n.text; });
    return notes;
  }

  // Notes are newest first, so walk them oldest first and start a new group at each [1/n].
  function findOrder(notes) {
    let group = null;
    let last = null;
    for (const note of notes.slice().reverse()) {
      const m = note.text.match(PART_RE);
      if (!m) continue;
      const i = +m[1];
      const n = +m[2];
      const body = note.text.slice(m[0].length);
      if (i === 1 && /^ORDER DATA/.test(body)) group = { n, parts: [], notes: [] };
      if (!group || group.n !== n) continue;
      group.parts[i - 1] = body;
      group.notes.push(note);
      if (group.parts.filter((p) => p != null).length === n) last = group;
    }
    if (!last) return null;
    const joined = last.parts.join('').replace(/^ORDER DATA\s*/, '');
    try {
      return { data: JSON.parse(joined), notes: last.notes };
    } catch (e) {
      // A part may have ended on a space that the page trimmed off.
      try { return { data: JSON.parse(last.parts.join(' ').replace(/^ORDER DATA\s*/, '')), notes: last.notes }; } catch (e2) {}
      return { error: 'The ORDER DATA notes could not be read.', notes: last.notes };
    }
  }

  // Wraps the order so every field render() reads is remembered (array items as "[]").
  function tracked(obj, used, path) {
    if (obj == null || typeof obj !== 'object') return obj;
    return new Proxy(obj, {
      get(target, key) {
        const v = target[key];
        if (typeof key !== 'string') return v;
        const isIndex = Array.isArray(target) && /^\d+$/.test(key);
        if (Array.isArray(target) && !isIndex) return v; // length, map… run against the proxy
        const p = isIndex ? path + '[]' : (path ? path + '.' + key : key);
        used.add(p);
        return tracked(v, used, p);
      },
    });
  }

  // Every leaf in the order as [path, value], array items flattened with their index.
  function leaves(v, path, out) {
    if (v !== null && typeof v === 'object' && (Array.isArray(v) ? v.length : Object.keys(v).length)) {
      if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${path}[${i}]`, out));
      else Object.keys(v).forEach((k) => leaves(v[k], path ? path + '.' + k : k, out));
    } else out.push([path, v]);
    return out;
  }

  function money(v, cur) {
    if (v == null || v === '') return '';
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'GBP' }).format(v);
    } catch (e) {
      return Number(v).toFixed(2);
    }
  }

  function date(v, withTime) {
    if (!v) return '';
    const d = new Date(v.length === 10 ? v + 'T12:00:00' : v);
    if (isNaN(d)) return v;
    const opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' };
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('en-GB', opts);
  }

  const yesNo = (v) => (v == null ? '' : v ? 'Yes' : 'No');
  const words = (v) => (v == null ? '' : String(v).replace(/[_,]/g, (c) => (c === ',' ? ', ' : ' ')));
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  // dl rows; rows with no value are left out (their field still counts as shown).
  function rows(list) {
    const html = list.filter(([, v]) => v !== '' && v != null)
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
    return html ? `<dl>${html}</dl>` : '';
  }

  function sec(title, body, aside) {
    if (!body) return '';
    const head = title ? `<div class="f8-h">${esc(title)}${aside ? `<small>${aside}</small>` : ''}</div>` : '';
    return `<div class="f8-sec">${head}${body}</div>`;
  }

  function address(a) {
    if (!a) return '<span class="f8-m">None</span>';
    const town = [a.city, a.county].filter(Boolean).join(', ');
    return [
      a.company ? `<b>${esc(a.company)}</b>` : '',
      esc(a.name), esc(a.line1), esc(a.line2), esc(town), esc(a.postcode), esc(a.country),
      a.phone ? `<span class="f8-m">${esc(a.phone)}</span>` : '',
    ].filter(Boolean).join('<br>');
  }

  function sameAddress(a, b) {
    const keys = ['company', 'name', 'line1', 'line2', 'city', 'county', 'postcode', 'country', 'phone'];
    return !!a && !!b && keys.every((k) => (a[k] || '') === (b[k] || ''));
  }

  // The website's one-line "Web reference: … Payment: …" note for this order, if there is one.
  function findSummaryNote(notes, ref) {
    return notes.find((n) => /^Web reference:/.test(n.text) && (!ref || n.text.indexOf(ref) !== -1)) || null;
  }

  function render(raw, summary) {
    const used = new Set();
    const o = tracked(raw, used, '');
    const c = o.customer || {};
    const p = o.payment || {};
    const t = o.totals || {};
    const d = o.delivery || {};
    const ck = o.checkout || {};
    const ad = o.addresses || {};
    const cur = p.currency || c.currency || 'GBP';
    const m = (v) => esc(money(v, cur));

    // Status pills
    const pills = [];
    if (p.paid) pills.push('<span class="f8-pill ok">Paid</span>');
    else if (p.on_account) pills.push('<span class="f8-pill warn">On account</span>');
    else if (p.awaiting_funds) pills.push('<span class="f8-pill warn">Awaiting funds</span>');
    else pills.push('<span class="f8-pill bad">Not paid</span>');
    pills.push(c.guest ? '<span class="f8-pill">Guest</span>' : '<span class="f8-pill">Account</span>');
    if (ck.channel) pills.push(`<span class="f8-pill">${esc(String(ck.channel).toUpperCase())}</span>`);

    const hero = `
      <div class="f8-hero">
        <div>
          <div class="f8-ref">${esc(o.web_reference)}<button type="button" class="f8-copy" data-copy="${esc(o.web_reference)}" aria-label="Copy web reference">Copy</button></div>
          <div class="f8-when">Placed ${esc(date(o.placed_at, true))}</div>
        </div>
        <div class="f8-total"><b>${m(t.order_total)}</b><span>inc VAT · ${esc(cur)}</span></div>
      </div>`;

    const customer = sec('Customer', rows([
      ['Account', c.account_name ? `${esc(c.account_name)}${c.account_code ? ` <span class="f8-m">${esc(c.account_code)}</span>` : ''}` : esc(c.account_code)],
      ['Email', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''],
      ['Placed by', esc(c.placed_by)],
      ['Checkout', `${c.guest ? 'Guest' : 'Account'} · ${c.signed_in ? 'signed in' : 'not signed in'}`],
      ['New account', summary && /Account opened for this order/i.test(summary.text) ? 'Opened for this order' : ''],
      ['Price list', esc(c.pricelist_name)],
      ['Tax group', esc([c.tax_group, c.currency].filter(Boolean).join(' · '))],
      ['Purchase order', o.purchase_order ? esc(o.purchase_order) : '<span class="f8-m">None</span>'],
    ]));

    const gateway = p.gateway ? cap(String(p.gateway).split('.').pop()) : '';
    const payment = sec('Payment', rows([
      ['Paid with', esc(p.description)],
      ['Status', [p.paid ? 'Paid' : 'Not paid', p.awaiting_funds ? 'awaiting funds' : '', p.on_account ? 'on account' : ''].filter(Boolean).join(' · ')],
      ['Authorised', p.authorised != null ? `${m(p.authorised)}${p.authorised !== t.order_total ? ' <span class="f8-m">(differs from total)</span>' : ''}` : ''],
      ['Terms', esc(p.terms)],
      ['Gateway', gateway ? `${esc(gateway)}${p.via_psp ? ' <span class="f8-m">via card processor</span>' : ''}` : ''],
      ['Methods offered', esc(cap(words(p.payment_method)))],
      ['Stripe payment', p.payment_intent ? `<a class="f8-mono" href="https://dashboard.stripe.com/payments/${encodeURIComponent(p.payment_intent)}" target="_blank" rel="noopener">${esc(p.payment_intent)}</a>` : ''],
    ]));

    const shipments = (d.shipments || []).map((s) => `
      <div class="f8-ship">
        <div class="f8-row"><b>Delivery ${esc(s.number)}</b><span>${esc(date(s.delivery_date))}</span></div>
        ${(s.lines || []).map((x) => `<div class="f8-row f8-m"><span class="f8-mono">${esc(x.sku)}</span><span>× ${esc(x.quantity)}</span></div>`).join('')}
      </div>`).join('');
    const unscheduled = (d.unscheduled || []).length
      ? `<div class="f8-ship"><b>Not scheduled</b>${d.unscheduled.map((x) => `<div class="f8-m f8-mono">${esc(typeof x === 'object' ? `${x.sku || ''} × ${x.quantity || ''}` : x)}</div>`).join('')}</div>`
      : '';
    const delivery = sec('Delivery', rows([
      ['Arrangement', esc(cap(words(d.arrangement)))],
      ['Dispatch from', esc(date(d.dispatch_start))],
      ['Delivery due', esc(date(d.delivery_due))],
      ['Dispatch mode', esc(d.dispatch_mode)],
      ['Method', esc(ck.delivery_method_id)],
    ]) + shipments + unscheduled);

    const lines = (o.lines || []).map((l) => {
      const tags = [
        l.variant && l.variant !== l.uom ? `<span class="f8-tag">${esc(l.variant)}</span>` : '',
        l.uom ? `<span class="f8-tag">UOM ${esc(l.uom)}${l.uom_id != null ? ` · id ${esc(l.uom_id)}` : ''}</span>` : '',
        l.parent_sku ? `<span class="f8-tag">Parent ${esc(l.parent_sku)}</span>` : '',
        l.sent_sku ? `<span class="f8-tag">Sent to TradePeg as ${esc(l.sent_sku)}${l.sent_unit_price != null ? ` @ ${m(l.sent_unit_price)}` : ''}</span>` : '',
        l.due ? `<span class="f8-tag due">${esc(l.due)}</span>` : '',
      ].join('');
      return `
        <div class="f8-line">
          <div class="f8-row"><span class="f8-sku">${esc(l.sku)}</span><b>${m(l.line_net)}</b></div>
          ${l.name ? `<div>${esc(l.name)}</div>` : ''}
          <div class="f8-row f8-m"><span>${esc(l.quantity)} × ${m(l.unit_price_net)} net</span><span>VAT ${esc(l.vat_rate != null ? Math.round(l.vat_rate * 1000) / 10 + '%' : '')} · ${m(l.line_gross)} gross</span></div>
          <div class="f8-tags">${tags}</div>
        </div>`;
    }).join('');
    const items = sec('Items', lines || '<span class="f8-m">No lines</span>',
      `${esc(t.line_count)} line${t.line_count === 1 ? '' : 's'} · ${esc(t.unit_count)} unit${t.unit_count === 1 ? '' : 's'}`);

    const totals = sec('Totals', `<div class="f8-sums">
      <div><span>Goods (net)</span><span>${m(t.goods_net)}</span></div>
      <div><span>Carriage (net)</span><span>${m(t.carriage_net)}</span></div>
      <div><span>VAT</span><span>${m(t.vat)}</span></div>
      <div><span class="f8-m">Goods (gross)</span><span class="f8-m">${m(t.goods_gross)}</span></div>
      <div class="f8-grand"><span>Order total</span><span>${m(t.order_total)}</span></div>
    </div>`);

    const same = ad.billing_same_as_shipping || sameAddress(ad.shipping, ad.billing);
    const addresses = sec('Addresses', `<div class="f8-addr">
      <div><div class="f8-h">Delivery</div>${address(ad.shipping)}</div>
      <div><div class="f8-h">Billing</div>${same && ad.billing ? `<span class="f8-m">Same as delivery</span>` : address(ad.billing)}</div>
    </div>`);
    if (same && ad.billing) address(ad.billing); // still read, so it isn't listed under Other fields

    const notes = sec('Notes from the customer', [
      ['Order note', o.customer_note],
      ['Delivery instructions', o.delivery_instructions],
    ].map(([k, v]) => v
      ? `<div class="f8-note"><b>${esc(k)}:</b> ${esc(v)}</div>`
      : `<div class="f8-m">${esc(k)}: none</div>`).join(''));

    const technical = sec('', `<details><summary>Technical details</summary>${rows([
      ['Data version', esc(o.v)],
      ['Contact ID', `<span class="f8-mono">${esc(c.contact_id)}</span>`],
      ['Person ID', esc(c.person_id)],
      ['Price list ID', esc(c.pricelist_id)],
      ['Cart ID', `<span class="f8-mono">${esc(ck.cart_id)}</span>`],
      ['Cart opened', esc(date(ck.created_at, true))],
      ['Cart updated', esc(date(ck.updated_at, true))],
      ['Gateway ID', `<span class="f8-mono">${esc(p.gateway)}</span>`],
      ['Transaction', p.transaction_id ? `<span class="f8-mono">${esc(p.transaction_id)}</span>` : ''],
      ['Billing same flag', esc(yesNo(ad.billing_same_as_shipping))],
    ])}</details>`);

    // Anything the layout above didn't read.
    const other = leaves(raw, '', [])
      .filter(([path, v]) => !used.has(path.replace(/\[\d+\]/g, '[]')) && v !== null && v !== '')
      .map(([path, v]) => [path, `<span class="f8-mono">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`]);
    const others = other.length ? sec('Other fields', rows(other)) : '';

    return {
      pills: pills.join(''),
      body: hero + items + totals + customer + payment + delivery + addresses + notes + others + technical,
    };
  }

  // Fold the website's notes down to one line; click to show them again.
  function foldNotes(notes) {
    notes.forEach(({ area, text }) => {
      if (area.querySelector('.farla08-folded')) return;
      const m = text.match(PART_RE);
      const kids = Array.from(area.childNodes).filter((n) => !(n.classList && n.classList.contains('infoRow')));
      const label = document.createElement('div');
      label.className = 'farla08-folded';
      label.textContent = `${m ? `Order data part ${m[1]}/${m[2]}` : 'Order summary'} — shown in the Website order box (click to show)`;
      label.addEventListener('click', () => {
        const hidden = label.dataset.open !== '1';
        label.dataset.open = hidden ? '1' : '0';
        kids.forEach((k) => {
          if (k.nodeType === 3) k.textContent = hidden ? k.__f8 : '';
          else k.style.display = hidden ? '' : 'none';
        });
        label.textContent = label.textContent.replace(hidden ? 'click to show' : 'click to hide', hidden ? 'click to hide' : 'click to show');
      });
      kids.forEach((k) => {
        if (k.nodeType === 3) { k.__f8 = k.textContent; k.textContent = ''; } else k.style.display = 'none';
      });
      area.appendChild(label);
    });
  }

  // Under the Notes panel, inside the same column so it's the same width.
  // Outside #notes-holder, which TradePeg refills on Refresh.
  function placeBox(box) {
    const notes = document.getElementById('notes-holder');
    if (!notes) return false;
    notes.after(box);
    return true;
  }

  let lastKey = '';
  function run() {
    const existing = document.getElementById(BOX_ID);
    if (!isSalesOrderPage()) { if (existing) existing.remove(); lastKey = ''; return; }
    const notes = readNotes();
    const found = findOrder(notes);
    if (!found) { if (existing) existing.remove(); lastKey = ''; return; }

    const summary = found.data ? findSummaryNote(notes, found.data.web_reference) : null;
    const toFold = summary ? found.notes.concat(summary) : found.notes;
    const key = location.pathname + '|' + toFold.map((n) => n.text).join('');
    if (existing && key === lastKey && existing.isConnected) { foldNotes(toFold); return; }

    addStyle();
    const box = existing || document.createElement('div');
    box.id = BOX_ID;
    // TradePeg's own panel classes, so it lines up with the Notes panel above.
    box.className = 'panel panel-default fluid no-print';
    const out = found.error
      ? { pills: '', body: `<div class="f8-sec f8-m">${esc(found.error)}</div>` }
      : render(found.data, summary);
    box.innerHTML = `<div class="panel-heading">Website order<div class="f8-pills">${out.pills}</div></div>
      <div class="panel-body">${out.body}</div>`;
    if (!existing && !placeBox(box)) return;
    lastKey = key;
    if (!found.error) foldNotes(toFold);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest(`#${BOX_ID} .f8-copy`);
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.copy).then(() => {
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
    });
  });

  // TradePeg loads notes and pages by ajax, so watch the page and re-check.
  let timer = null;
  new MutationObserver((muts) => {
    if (muts.every((m) => m.target.closest && m.target.closest('#' + BOX_ID))) return;
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });
  run();
})();
