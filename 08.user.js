// ==UserScript==
// @name         Farla 08 - Website Order Summary
// @namespace    farla-office-scripts
// @version      1.0.1
// @description  Turns the website's ORDER DATA notes on a TradePeg sales order into a summary box
// @match        https://farla2.tradepeg.net/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/08.user.js
// @downloadURL  https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/08.user.js
// ==/UserScript==

// The website writes each order into the SO's notes as "[1/2] ORDER DATA {json…",
// "[2/2] …rest of json". This joins the parts, reads the JSON and shows it as a
// box under the Notes. The raw parts are folded down to one line in the notes.
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
    css.textContent = `
#${BOX_ID}{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:18px 20px;margin:10px 0 14px;
  font:13px/1.45 "Segoe UI",Arial,sans-serif;color:#1f2328;box-shadow:0 1px 2px rgba(0,0,0,.04)}
#${BOX_ID} .f8-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
#${BOX_ID} .f8-kicker{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em}
#${BOX_ID} .f8-ref{font-size:15px;font-weight:600;margin-top:2px}
#${BOX_ID} .f8-copy{font-size:11px;margin-left:8px;color:#6b7280;cursor:pointer;font-weight:400}
#${BOX_ID} .f8-copy:hover{color:#1f2328}
#${BOX_ID} .f8-pills{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
#${BOX_ID} .f8-pill{font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;background:#eef0f3;color:#4b5563}
#${BOX_ID} .f8-pill.ok{background:#dcfce7;color:#166534}
#${BOX_ID} .f8-pill.warn{background:#fef3c7;color:#92400e}
#${BOX_ID} .f8-pill.bad{background:#fee2e2;color:#991b1b}
#${BOX_ID} hr{border:0;border-top:1px solid #eceef1;margin:14px 0}
#${BOX_ID} .f8-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px 24px}
#${BOX_ID} .f8-label{font-size:11px;color:#6b7280}
#${BOX_ID} .f8-val{font-size:14px;font-weight:600}
#${BOX_ID} .f8-sub{font-size:11px;color:#6b7280}
#${BOX_ID} .f8-h{font-weight:600;font-size:14px;margin-bottom:8px}
#${BOX_ID} table{width:100%;border-collapse:collapse}
#${BOX_ID} th{font-size:11px;color:#6b7280;font-weight:600;text-align:left;padding:6px 0;border-bottom:1px solid #eceef1}
#${BOX_ID} td{padding:7px 0;border-bottom:1px solid #f1f3f5;vertical-align:top}
#${BOX_ID} .r{text-align:right}
#${BOX_ID} .f8-totals{margin-left:auto;max-width:320px}
#${BOX_ID} .f8-totals div{display:flex;justify-content:space-between;padding:3px 0;color:#4b5563}
#${BOX_ID} .f8-totals .f8-grand{color:#1f2328;font-weight:700;font-size:15px;border-top:1px solid #eceef1;margin-top:4px;padding-top:7px}
#${BOX_ID} .f8-note{background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 10px;margin-top:10px}
#${BOX_ID} a{color:#2563eb}
.farla08-folded{color:#9ca3af;font-style:italic;cursor:pointer}
.farla08-folded:hover{color:#4b5563}
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
    const opts = { day: 'numeric', month: 'short', year: 'numeric' };
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('en-GB', opts);
  }

  function addressLines(a) {
    if (!a) return '';
    return [a.company, a.name, a.line1, a.line2, a.city, a.county, a.postcode, a.country]
      .filter((x) => x && String(x).trim()).map(esc).join(', ');
  }

  function sameAddress(a, b) {
    const keys = ['company', 'name', 'line1', 'line2', 'city', 'county', 'postcode', 'country'];
    return !!a && !!b && keys.every((k) => (a[k] || '') === (b[k] || ''));
  }

  function field(label, value, sub) {
    if (!value) return '';
    return `<div><div class="f8-label">${esc(label)}</div><div class="f8-val">${value}</div>${sub ? `<div class="f8-sub">${sub}</div>` : ''}</div>`;
  }

  function render(o) {
    const cur = (o.payment && o.payment.currency) || (o.customer && o.customer.currency) || 'GBP';
    const c = o.customer || {};
    const p = o.payment || {};
    const t = o.totals || {};
    const d = o.delivery || {};
    const ad = o.addresses || {};
    const ship = ad.shipping;
    const bill = ad.billing;

    const pills = [];
    if (p.paid) pills.push('<span class="f8-pill ok">Paid</span>');
    else if (p.on_account) pills.push('<span class="f8-pill warn">On account</span>');
    else if (p.awaiting_funds) pills.push('<span class="f8-pill warn">Awaiting funds</span>');
    else pills.push('<span class="f8-pill bad">Not paid</span>');
    if (c.guest) pills.push('<span class="f8-pill">Guest checkout</span>');
    if (o.checkout && o.checkout.channel) pills.push(`<span class="f8-pill">${esc(String(o.checkout.channel).toUpperCase())}</span>`);

    const who = c.placed_by || (ship && ship.name) || '';
    const custSub = [c.account_code, c.email, c.signed_in ? 'Signed in' : ''].filter(Boolean).map(esc).join(' · ');
    const payment = p.payment_intent
      ? `${esc(p.description || 'Card')}<div class="f8-sub">${esc(p.terms || '')}${p.terms ? ' · ' : ''}<a href="https://dashboard.stripe.com/payments/${encodeURIComponent(p.payment_intent)}" target="_blank" rel="noopener">${esc(p.payment_intent)}</a></div>`
      : esc(p.description || p.terms || '');
    const paySub = p.authorised != null && p.authorised !== t.order_total ? `Authorised ${money(p.authorised, cur)}` : '';

    const lines = (o.lines || []).map((l) => {
      const extra = [
        l.name,
        l.variant && l.variant !== l.uom ? l.variant : '',
        l.uom ? `UOM: ${l.uom}` : '',
        l.sent_sku && l.sent_sku !== l.sku ? `Sent as ${l.sent_sku}` : '',
        l.due,
      ].filter(Boolean).map(esc).join(' · ');
      return `<tr>
        <td>${esc(l.sku)}${extra ? `<div class="f8-sub">${extra}</div>` : ''}</td>
        <td class="r">${esc(l.quantity)}</td>
        <td class="r">${money(l.unit_price_net, cur)}</td>
        <td class="r">${money(l.line_net, cur)}</td>
      </tr>`;
    }).join('');

    const shipments = (d.shipments || []).length > 1
      ? `<div style="margin-top:8px">${d.shipments.map((s) =>
          `<div class="f8-sub"><b>Delivery ${esc(s.number)}</b> — ${esc(date(s.delivery_date))}: ${(s.lines || []).map((x) => `${esc(x.sku)} × ${esc(x.quantity)}`).join(', ')}</div>`).join('')}</div>`
      : '';
    const unscheduled = (d.unscheduled || []).length
      ? `<div class="f8-sub" style="margin-top:4px"><b>Not scheduled:</b> ${d.unscheduled.map((x) => esc(x.sku || x)).join(', ')}</div>`
      : '';

    const notes = [
      o.customer_note ? `<div class="f8-note"><b>Customer note:</b> ${esc(o.customer_note)}</div>` : '',
      o.delivery_instructions ? `<div class="f8-note"><b>Delivery instructions:</b> ${esc(o.delivery_instructions)}</div>` : '',
    ].join('');

    return `
      <div class="f8-top">
        <div>
          <div class="f8-kicker">Website order</div>
          <div class="f8-ref">${esc(o.web_reference)}<span class="f8-copy" data-copy="${esc(o.web_reference)}" title="Copy">copy</span></div>
        </div>
        <div class="f8-pills">${pills.join('')}</div>
      </div>
      <hr>
      <div class="f8-grid">
        ${field('Customer', esc(c.account_name || (ship && ship.company) || who), custSub)}
        ${field('Order date', esc(date(o.placed_at, true)))}
        ${field('Contact', esc(who), ship && ship.phone ? esc(ship.phone) : '')}
        ${field('Purchase order', esc(o.purchase_order))}
        ${field('Payment', payment, paySub)}
        ${field('Dispatch', esc(date(d.dispatch_start)), d.arrangement ? esc(String(d.arrangement).replace(/_/g, ' ')) : '')}
        ${field('Delivery due', esc(date(d.delivery_due)))}
        ${field('Price list', esc(c.pricelist_name))}
      </div>
      ${shipments}${unscheduled}
      <hr>
      <div class="f8-h">Items ordered</div>
      <table>
        <thead><tr><th>SKU</th><th class="r">Qty</th><th class="r">Unit net</th><th class="r">Net</th></tr></thead>
        <tbody>${lines || '<tr><td colspan="4" class="f8-sub">No lines</td></tr>'}</tbody>
      </table>
      <div class="f8-totals" style="margin-top:10px">
        <div><span>Subtotal</span><span>${money(t.goods_net, cur)}</span></div>
        ${t.carriage_net ? `<div><span>Carriage</span><span>${money(t.carriage_net, cur)}</span></div>` : ''}
        <div><span>VAT</span><span>${money(t.vat, cur)}</span></div>
        <div class="f8-grand"><span>Order total</span><span>${money(t.order_total, cur)}</span></div>
      </div>
      ${notes}
      <hr>
      <div class="f8-grid">
        ${field('Delivery address', `<span style="font-weight:400">${addressLines(ship)}</span>`)}
        ${bill && !sameAddress(ship, bill) ? field('Billing address', `<span style="font-weight:400">${addressLines(bill)}</span>`) : ''}
      </div>`;
  }

  // Fold the raw JSON parts down to one line; click to show them again.
  function foldNotes(notes) {
    notes.forEach(({ area, text }) => {
      if (area.querySelector('.farla08-folded')) return;
      const m = text.match(PART_RE);
      const kids = Array.from(area.childNodes).filter((n) => !(n.classList && n.classList.contains('infoRow')));
      const label = document.createElement('div');
      label.className = 'farla08-folded';
      label.textContent = `Order data part ${m ? m[1] + '/' + m[2] : ''} — shown in the Website order box (click to show)`;
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

  // Under the Notes panel. Outside #notes-holder, which TradePeg refills on Refresh.
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

    const key = location.pathname + '|' + found.notes.map((n) => n.text).join('');
    if (existing && key === lastKey && existing.isConnected) { foldNotes(found.notes); return; }

    addStyle();
    const box = existing || document.createElement('div');
    box.id = BOX_ID;
    box.className = 'no-print';
    box.innerHTML = found.error
      ? `<div class="f8-kicker">Website order</div><div class="f8-sub" style="margin-top:6px">${esc(found.error)}</div>`
      : render(found.data);
    if (!existing && !placeBox(box)) return;
    lastKey = key;
    if (!found.error) foldNotes(found.notes);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest(`#${BOX_ID} .f8-copy`);
    if (!btn) return;
    navigator.clipboard.writeText(btn.dataset.copy).then(() => {
      btn.textContent = 'copied';
      setTimeout(() => { btn.textContent = 'copy'; }, 1200);
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
