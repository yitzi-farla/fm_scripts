// ==UserScript==
// @name         Farla 01 - TradePeg SO/PO UOM Drilldown
// @namespace    farla-tradepeg
// @version      0.4.1
// @description  Add cached UOM drilldown with Shelf Qty, EAN, SKU and ASIN to SO/PO line items
// @match        https://farla2.tradepeg.net/app/en-gb/doc/so/*
// @match        https://farla2.tradepeg.net/wapp/en-gb/doc/so/*
// @match        https://farla2.tradepeg.net/app/en-gb/doc/po/*
// @match        https://farla2.tradepeg.net/wapp/en-gb/doc/po/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/01.user.js
// @downloadURL  https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/01.user.js
// ==/UserScript==

(function () {
  'use strict';

  const MAX_UOM_ID_TO_PROBE = 2;   // Checks /uom/0 through /uom/8. Reduce to 2 if only Unit/Pack/Case exist.
  const REQUEST_DELAY_MS = 0;      // Set to 50-100 if you want to be gentler on the server.
  const productCache = new Map();
  const CACHE_VERSION = 'v2-uom-sort-unit-pack-case';

  injectStyles();

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function cacheKey(productId) {
    return `tradepeg-uom-drilldown:${CACHE_VERSION}:${productId}`;
  }

  function getRows() {
    return Array.from(document.querySelectorAll([
      'tr[id][class*="tr_sodetail_"]',      // SO rows
      '#details tbody tr[id^="tr_detail_"]' // PO rows
    ].join(',')));
  }

  function extractProductIdFromRow(row) {
    const link = row.querySelector('a[href*="/inventory/products/details/"]');
    if (!link) return null;

    const match = link.href.match(/\/inventory\/products\/details\/([0-9a-f-]{36})/i);
    return match ? match[1] : null;
  }

  function extractProductLabelFromRow(row) {
    const link = row.querySelector('a[href*="/inventory/products/details/"]');
    return link ? link.textContent.trim() : '';
  }

  function findUomCell(row) {
    const cells = Array.from(row.querySelectorAll('td'));

    return cells.find(td => {
      const text = td.childNodes[0]?.textContent?.trim() || td.textContent.trim();
      return ['Unit', 'Pack', 'Case'].includes(text);
    });
  }

  function inputValue(doc, selector) {
    const el = doc.querySelector(selector);
    return el ? el.value.trim() : '';
  }

  function textValue(doc, selector) {
    const el = doc.querySelector(selector);
    return el ? el.textContent.trim() : '';
  }

  function uomSortOrder(uomName) {
    const normalized = String(uomName || '').trim().toLowerCase();
    const order = {
      unit: 0,
      pack: 1,
      case: 2
    };

    return Object.prototype.hasOwnProperty.call(order, normalized) ? order[normalized] : 999;
  }

  function sortUoms(uoms) {
    return [...(uoms || [])].sort((a, b) => {
      const primary = uomSortOrder(a.uomName) - uomSortOrder(b.uomName);
      if (primary !== 0) return primary;
      return Number(a.uomId || 0) - Number(b.uomId || 0);
    });
  }

  function parseUomHtml(html, requestedUomId) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const productId = inputValue(doc, 'input[name="productId"]');
    const returnedUomId = inputValue(doc, 'input[name="uomId"]');

    // UOM name is shown as a span.form-control, e.g. Unit / Pack / Case.
    const uomName = textValue(doc, '.formRow .grid4 .form-control');

    const uomRef = inputValue(doc, 'input[name="uom_ref"]');
    const ean = inputValue(doc, 'input[name="ean"]');
    const shelfQty = inputValue(doc, 'input[name="qty"]');
    const asin = inputValue(doc, 'input[name="asin"]');

    // If the endpoint did not return a useful UOM form, ignore it.
    if (!productId || !uomName) return null;

    return {
      uomId: returnedUomId || String(requestedUomId),
      uomName,
      shelfQty,
      asin,
      uomRef,
      ean
    };
  }

  async function fetchOneUom(productId, uomId) {
    const url = `/wapp/en-gb/inventory/products/${productId}/uom/${uomId}?minimal=`;

    try {
      const res = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });

      if (!res.ok) return null;

      const html = await res.text();
      return parseUomHtml(html, uomId);
    } catch (err) {
      console.warn('UOM fetch failed', { productId, uomId, err });
      return null;
    }
  }

  async function fetchAllUomsForProduct(productId) {
    if (productCache.has(productId)) {
      return productCache.get(productId);
    }

    const stored = sessionStorage.getItem(cacheKey(productId));
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        productCache.set(productId, parsed);
        return parsed;
      } catch {
        sessionStorage.removeItem(cacheKey(productId));
      }
    }

    const promise = (async () => {
      const results = [];

      for (let uomId = 0; uomId <= MAX_UOM_ID_TO_PROBE; uomId++) {
        if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);

        const uom = await fetchOneUom(productId, uomId);

        if (uom) {
          const duplicate = results.some(x => x.uomId === uom.uomId || x.uomName === uom.uomName);
          if (!duplicate) results.push(uom);
        }
      }

      results.sort((a, b) => uomSortOrder(a.uomName) - uomSortOrder(b.uomName));

      sessionStorage.setItem(cacheKey(productId), JSON.stringify(results));
      productCache.set(productId, results);

      return results;
    })();

    productCache.set(productId, promise);
    return promise;
  }

  function buildPopover(productLabel, uoms) {
    uoms = sortUoms(uoms || []);

    const wrap = document.createElement('div');
    wrap.className = 'tp-uom-popover';

    const title = document.createElement('div');
    title.className = 'tp-uom-title';
    title.textContent = productLabel || 'Product UOMs';
    wrap.appendChild(title);

    if (!uoms || uoms.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tp-uom-empty';
      empty.textContent = 'No UOM data found';
      wrap.appendChild(empty);
      return wrap;
    }

    const table = document.createElement('table');
    table.className = 'tp-uom-table';

    table.innerHTML = `
      <thead>
        <tr>
          <th>UOM</th>
          <th>Shelf Qty</th>
          <th>ASIN</th>
          <th>SKU / Ref</th>
          <th>EAN</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');

    for (const uom of sortUoms(uoms)) {
      const tr = document.createElement('tr');

      const isBlankRow = !String(uom.shelfQty || '').trim()
        && !String(uom.asin || '').trim()
        && !String(uom.uomRef || '').trim()
        && !String(uom.ean || '').trim();

      if (isBlankRow) {
        tr.classList.add('tp-uom-blank-row');
      }

      tr.innerHTML = `
        ${tableCell(uom.uomName)}
        ${tableCell(uom.shelfQty)}
        ${tableCell(uom.asin)}
        ${tableCell(uom.uomRef)}
        ${tableCell(uom.ean)}
      `;

      tbody.appendChild(tr);
    }

    wrap.appendChild(table);
    return wrap;
  }

  function tableCell(value) {
    const text = String(value || '').trim();
    return `<td>${escapeHtml(text)}</td>`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function removeOpenPopovers() {
    document.querySelectorAll('.tp-uom-popover').forEach(el => el.remove());
    document.querySelectorAll('.tp-uom-badge.tp-open').forEach(el => {
      el.classList.remove('tp-open');
      if (el.dataset.loadedText) el.textContent = el.dataset.loadedText;
    });
  }

  function positionPopover(popover, anchor) {
    const margin = 8;

    // Start hidden so the browser can measure the popover correctly.
    popover.style.visibility = 'hidden';
    popover.style.position = 'fixed';
    popover.style.top = '0px';
    popover.style.left = '0px';
    popover.style.zIndex = '999999';

    const anchorRect = anchor.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();

    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;

    let top;

    if (spaceBelow >= popRect.height + margin || spaceBelow >= spaceAbove) {
      // Open below.
      top = anchorRect.bottom + margin;
      popover.classList.remove('tp-uom-popover-above');
      popover.classList.add('tp-uom-popover-below');
    } else {
      // Open above.
      top = anchorRect.top - popRect.height - margin;
      popover.classList.remove('tp-uom-popover-below');
      popover.classList.add('tp-uom-popover-above');
    }

    let left = anchorRect.left;

    // Prevent right overflow.
    if (left + popRect.width > window.innerWidth - margin) {
      left = window.innerWidth - popRect.width - margin;
    }

    // Prevent left overflow.
    if (left < margin) {
      left = margin;
    }

    // Prevent top overflow.
    if (top < margin) {
      top = margin;
    }

    // Prevent bottom overflow if the popover is very tall.
    if (top + popRect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - popRect.height - margin);
    }

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.style.visibility = 'visible';
  }

  function clearNativeHoverTitle(uomCell) {
    // Remove any tooltip/hover styling left by older versions of this script or by re-rendered rows.
    uomCell.removeAttribute('title');
    uomCell.style.textDecoration = '';
    uomCell.style.cursor = '';

    uomCell.querySelectorAll('[title]').forEach(el => el.removeAttribute('title'));
  }

  function attachBadge(row, productId, productLabel) {
    if (row.dataset.tpUomDrilldownDone === '1') return;

    const uomCell = findUomCell(row);
    if (!uomCell) return;

    clearNativeHoverTitle(uomCell);

    row.dataset.tpUomDrilldownDone = '1';

    const badge = document.createElement('span');
    badge.className = 'tp-uom-badge';
    badge.textContent = 'UOM';
    badge.dataset.loadedText = 'UOM';
    badge.removeAttribute('title');

    uomCell.appendChild(document.createTextNode(' '));
    uomCell.appendChild(badge);

    badge.addEventListener('click', async event => {
      event.stopPropagation();

      const alreadyOpen = badge.classList.contains('tp-open');
      removeOpenPopovers();

      if (alreadyOpen) return;

      badge.classList.add('tp-open');
      badge.textContent = 'Loading...';

      const uoms = await fetchAllUomsForProduct(productId);

      badge.textContent = 'UOM';
      badge.dataset.loadedText = 'UOM';
      badge.removeAttribute('title');

      const popover = buildPopover(productLabel, uoms);
      document.body.appendChild(popover);
      positionPopover(popover, badge);
    });

    // Preload immediately on page load.
    fetchAllUomsForProduct(productId).then(uoms => {
      badge.removeAttribute('title');
      badge.classList.add('tp-loaded');
    });
  }

  async function scanAndPreload() {
    const rows = getRows();
    const products = new Map();

    for (const row of rows) {
      const productId = extractProductIdFromRow(row);
      if (!productId) continue;

      const productLabel = extractProductLabelFromRow(row);
      products.set(productId, productLabel);

      attachBadge(row, productId, productLabel);
    }

    // Start all unique product loads at once.
    await Promise.all(
      Array.from(products.keys()).map(productId => fetchAllUomsForProduct(productId))
    );

    console.log(`TradePeg UOM drilldown preload complete: ${products.size} unique products`);
  }

  function injectStyles() {
    const style = document.createElement('style');

    style.textContent = `
      td:has(.tp-uom-badge) {
        text-decoration: none !important;
        cursor: default !important;
      }

      .tp-uom-badge {
        display: inline-block;
        margin-left: 4px;
        padding: 1px 5px;
        border-radius: 8px;
        background: #777;
        color: #fff;
        font-size: 10px;
        line-height: 14px;
        cursor: pointer;
        position: relative;
        user-select: none;
        vertical-align: middle;
      }

      .tp-uom-badge.tp-loaded {
        background: #2f8f46;
      }

      .tp-uom-badge.tp-open {
        background: #1f6fb2;
      }

      .tp-uom-popover {
        position: fixed;
        z-index: 999999;
        min-width: 620px;
        max-width: 850px;
        max-height: calc(100vh - 16px);
        overflow: auto;
        background: #fff;
        color: #222;
        border: 1px solid #999;
        border-radius: 4px;
        box-shadow: 0 4px 18px rgba(0,0,0,0.25);
        padding: 8px;
        font-size: 12px;
        line-height: 1.35;
        text-align: left;
        white-space: normal;
      }

      .tp-uom-title {
        font-weight: bold;
        margin-bottom: 6px;
        color: #111;
      }

      .tp-uom-empty {
        color: #777;
        padding: 8px;
      }

      .tp-uom-table {
        width: 100%;
        border-collapse: collapse;
      }

      .tp-uom-table th,
      .tp-uom-table td {
        border: 1px solid #ddd;
        padding: 4px 6px;
        color: #222;
        background: #fff;
        font-size: 12px;
      }

      .tp-uom-table th {
        background: #f3f3f3;
        font-weight: bold;
        position: sticky;
        top: 0;
        z-index: 1;
      }

      .tp-uom-table td:nth-child(3) {
        font-weight: bold;
      }

      .tp-uom-table tr.tp-uom-blank-row td {
        background: rgb(235, 204, 204);
      }
    `;

    document.head.appendChild(style);

    document.addEventListener('click', () => removeOpenPopovers());

    window.addEventListener('scroll', () => removeOpenPopovers(), true);
    window.addEventListener('resize', () => removeOpenPopovers());
  }

  function start() {
    setTimeout(scanAndPreload, 500);
    setTimeout(scanAndPreload, 1500);
    setTimeout(scanAndPreload, 3000);

    let timer = null;

    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(scanAndPreload, 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  start();
})();
