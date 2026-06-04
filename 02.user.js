// ==UserScript==
// @name         Farla 02 - TradePeg Product Sales Drilldown SO/PO Tabs
// @namespace    farla-tradepeg
// @version      1.7.2
// @description  Add product-specific Sales Order and Purchase/Receipt tabs to product detail pages with CSV export, sortable columns, and enriched RCT/PO rows
// @match        https://farla2.tradepeg.net/wapp/en-gb/inventory/products/details/*
// @match        https://farla2.tradepeg.net/app/en-gb/inventory/products/details/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/02.user.js
// @downloadURL  https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/02.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_ID = 'tp-product-so-po-tabs';
  const MAX_SO_DRILLDOWN_PAGES = 500;
  const MAX_PO_TOOLTIP_PAGES = 100;
  const MAX_EMPTY_SO_PAGES = 5;
  const INSTALL_RETRY_DELAY_MS = 1000;
  const MAX_INSTALL_RETRIES = 30;
  const PO_ENRICH_CONCURRENCY = 4;

  let installRetryCount = 0;
  let installRetryTimer = null;

  function getProductId() {
    const fromInput = document.querySelector('input[name="itemId"]')?.value?.trim();
    if (isUuid(fromInput)) return fromInput;
    const match = location.pathname.match(/\/inventory\/products\/details\/([0-9a-f-]{36})/i);
    return match ? match[1] : null;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  function pad2(value) { return String(value).padStart(2, '0'); }

  function formatTradePegDate(date) {
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
  }

  function buildSalesDrilldownParams(productId, page) {
    const params = new URLSearchParams();
    params.set('partId', productId);
    params.set('date1', '01/01/1900');
    params.set('date2', formatTradePegDate(new Date()));
    params.set('_', String(Date.now()));
    params.set('pg', String(page || 0));
    return params;
  }

  function buildPurchaseOrderParams(productId) {
    const params = new URLSearchParams();
    params.set('q', '1');
    params.set('warehouse', '');
    params.set('date1', '');
    params.set('date2', '');
    params.set('ref1', '');
    params.set('currency', '');
    params.set('date3', '');
    params.set('date4', '');
    params.set('partId', productId);
    params.set('direct_dispatch', '');
    params.set('rct_export', '');
    params.set('due_days', '');
    params.set('asnExists', '');
    params.set('custom_field_op_3', '=');
    params.set('custom_field_value_3', '');
    params.set('custom_field_value_4', '');
    return params;
  }

  function salesDrilldownUrl(productId, page) {
    return `/wapp/en-gb/reports/get/sales/sales-details-drilldown?${buildSalesDrilldownParams(productId, page).toString()}`;
  }

  function purchaseTooltipUrl(productId) {
    const safeProductId = encodeURIComponent(productId);
    return `/wapp/en-gb/inventory/products/tooltip/${safeProductId}/frame/purchase?r=${safeProductId}&_=${Date.now()}`;
  }

  function dataUrl(kind, productId) {
    if (kind === 'so') return salesDrilldownUrl(productId, 0);
    const params = buildPurchaseOrderParams(productId);
    params.set('_d', String(Date.now()));
    return `/wapp/en-gb/${kind}/data?${params.toString()}`;
  }

  function pageUrl(kind, productId) {
    const params = buildPurchaseOrderParams(productId);
    return `/wapp/en-gb/${kind}?${params.toString()}`;
  }

  function injectStyles() {
    if (document.getElementById(`${SCRIPT_ID}-styles`)) return;
    const style = document.createElement('style');
    style.id = `${SCRIPT_ID}-styles`;
    style.textContent = `
      .tp-product-doc-tab-panel .panel-heading { min-height: 42px; }
      .tp-product-doc-tab-panel .tp-product-doc-status { padding: 18px; color: #666; text-align: center; }
      .tp-product-doc-tab-panel .tp-product-doc-actions { margin-left: 8px; }
      .tp-product-doc-tab-panel .tp-product-doc-actions .btn { margin-left: 4px; }
      .tp-product-doc-tab-panel .tp-product-doc-results > div > #productResults > .panel { margin-bottom: 0; }
      .tp-product-doc-tab-panel .tp-product-doc-results #productResults > div > div.panel-heading { display: none !important; }
      .tp-product-doc-tab-panel .tp-product-line-table { margin-bottom: 0; }
      .tp-product-doc-tab-panel .tp-product-line-table th,
      .tp-product-doc-tab-panel .tp-product-line-table td { white-space: nowrap; vertical-align: middle; }
      .tp-product-doc-tab-panel .tp-product-muted { color: #999; }
      .tp-product-doc-tab-panel .tp-product-sortable { cursor: pointer; user-select: none; }
      .tp-product-doc-tab-panel .tp-product-sortable:hover { text-decoration: underline; }
    `;
    document.head.appendChild(style);
  }

  function createTab(tabId, label) {
    const li = document.createElement('li');
    li.setAttribute('role', 'presentation');
    li.dataset.tpProductDocTab = '1';
    const a = document.createElement('a');
    a.href = `#${tabId}`;
    a.setAttribute('aria-controls', tabId);
    a.setAttribute('role', 'tab');
    a.setAttribute('data-toggle', 'tab');
    a.textContent = label;
    li.appendChild(a);
    return li;
  }

  function createPane(tabId, kind, label, productId) {
    const pane = document.createElement('div');
    pane.id = tabId;
    pane.setAttribute('role', 'tabpanel');
    pane.className = 'tab-pane tp-product-doc-tab-panel';
    pane.dataset.tpProductDocKind = kind;
    pane.dataset.tpProductDocLoaded = '0';

    const openButtonHtml = kind === 'po'
      ? `<a class="btn btn-sm btn-default tp-product-doc-open" href="${escapeHtml(pageUrl(kind, productId))}" target="_blank">Open Full List</a>`
      : '';

    const exportButtonHtml = kind === 'so'
      ? `<button type="button" class="btn btn-sm btn-default tp-product-export-so-csv" data-product-id="${escapeHtml(productId)}"><i class="fa fa-download"></i>&nbsp;Export CSV</button>`
      : `<button type="button" class="btn btn-sm btn-default tp-product-export-po-csv" data-product-id="${escapeHtml(productId)}"><i class="fa fa-download"></i>&nbsp;Export CSV</button>`;

    pane.innerHTML = `
      <div class="panel ${kind === 'so' ? 'panel-customer' : 'panel-vendors'}">
        <div class="panel-heading">
          ${escapeHtml(label)}
          <div class="btns pull-right tp-product-doc-actions">
            ${openButtonHtml}
            ${exportButtonHtml}
            <a class="btn btn-sm btn-primary tp-product-doc-refresh" href="#">Refresh</a>
          </div>
        </div>
        <div class="panel-body p0 tp-product-doc-results">
          <div class="tp-product-doc-status">Click this tab to load product-specific ${escapeHtml(label)} results.</div>
        </div>
      </div>
    `;

    pane.querySelector('.tp-product-doc-refresh').addEventListener('click', event => {
      event.preventDefault();
      loadPane(pane, productId, true);
    });

    const soExportButton = pane.querySelector('.tp-product-export-so-csv');
    if (soExportButton) {
      soExportButton.addEventListener('click', event => {
        event.preventDefault();
        const lines = window.__tpProductSoLines?.[productId] || [];
        if (!lines.length) return alert('No Sales Order rows available to export yet. Load the Sales Order tab first.');
        downloadCsv(`tradepeg-product-sales-orders_${safeFilenamePart(productId)}_all-dates.csv`, buildSoCsv(lines));
      });
    }

    const poExportButton = pane.querySelector('.tp-product-export-po-csv');
    if (poExportButton) {
      poExportButton.addEventListener('click', event => {
        event.preventDefault();
        const lines = window.__tpProductPoLines?.[productId] || [];
        if (!lines.length) return alert('No Purchase/Receipt rows available to export yet. Load the Purchase/Receipt tab first.');
        downloadCsv(`tradepeg-product-purchase-receipts_${safeFilenamePart(productId)}_all-dates.csv`, buildPoCsv(lines));
      });
    }

    return pane;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function parseHtml(html) { return new DOMParser().parseFromString(html || '', 'text/html'); }
  function textOf(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
  function getCell(row, index) { return Array.from(row.children)[index] || null; }
  function getCellText(row, index) { return textOf(getCell(row, index)?.textContent || ''); }

  function splitPriceAndUom(priceCell) {
    if (!priceCell) return { price: '', uom: '' };
    const clone = priceCell.cloneNode(true);
    const possibleUomEl = clone.querySelector('.small-details.bold.red1') || clone.querySelector('.small-details') || clone.querySelector('.red1') || clone.querySelector('span');
    let uom = '';
    if (possibleUomEl) {
      uom = textOf(possibleUomEl.textContent || '');
      possibleUomEl.remove();
    }
    let price = textOf(clone.textContent || '');
    if (!uom) {
      const match = price.match(/^([£$€]?\s*-?\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*)([A-Za-z][A-Za-z0-9 /_-]*)$/);
      if (match) {
        price = textOf(match[1]);
        uom = textOf(match[2]);
      }
    }
    return { price, uom };
  }

  function splitPriceAndCurrency(value) {
    const text = textOf(value);
    const match = text.match(/^([£$€]?\s*-?\d+(?:,\d{3})*(?:\.\d+)?)(?:\s+)?([A-Z]{3})?$/i);
    if (!match) return { price: text, currency: '' };
    return { price: textOf(match[1]), currency: textOf(match[2] || '') };
  }

  function parseNumber(value) {
    const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
    if (!cleaned) return NaN;
    return Number(cleaned);
  }

  function numbersClose(a, b) {
    const av = parseNumber(a);
    const bv = parseNumber(b);
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return false;
    return Math.abs(av - bv) < 0.01;
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) return '';
    return value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parseTradePegDate(value) {
    const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return 0;
    const [, dd, mm, yyyy] = match;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd)).getTime();
  }

  async function fetchHtml(url) {
    const res = await fetch(url, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let index = 0;
    async function worker() {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
    return results;
  }

  function buildSoLineFromDrilldownRow(row) {
    const orderCell = getCell(row, 1);
    const orderLink = orderCell?.querySelector('a[href]') || null;
    const priceCell = getCell(row, 8);
    const priceInfo = splitPriceAndUom(priceCell);
    const requested = getCellText(row, 4);
    const confirmed = getCellText(row, 5);
    const packed = getCellText(row, 6);
    const invoiced = getCellText(row, 7);
    const priceNumber = parseNumber(priceInfo.price);
    const subtotalQty = parseNumber(invoiced || confirmed || requested);

    return {
      soNumber: textOf(orderLink?.textContent || orderCell?.textContent || ''),
      soHref: orderLink?.getAttribute('href') || '',
      date: getCellText(row, 2),
      customer: getCellText(row, 3),
      uom: priceInfo.uom || 'Unit',
      qtyRequested: requested,
      qtyConfirmed: confirmed,
      pack: packed,
      invoiced,
      price: priceInfo.price,
      subtotal: Number.isFinite(priceNumber) && Number.isFinite(subtotalQty) ? formatMoney(priceNumber * subtotalQty) : ''
    };
  }

  function getDrilldownRowsFromHtml(html) {
    const doc = parseHtml(html);
    return Array.from(doc.querySelectorAll('table tbody tr'))
      .filter(row => row.querySelector('a[href*="/doc/so/"]'))
      .map(row => buildSoLineFromDrilldownRow(row));
  }

  async function fetchSalesDrilldownLines(productId) {
    const lines = [];
    let emptyPages = 0;
    for (let page = 0; page <= MAX_SO_DRILLDOWN_PAGES; page += 1) {
      const html = await fetchHtml(salesDrilldownUrl(productId, page));
      const pageLines = getDrilldownRowsFromHtml(html);
      if (!pageLines.length) {
        emptyPages += 1;
        if (emptyPages >= MAX_EMPTY_SO_PAGES) break;
        continue;
      }
      emptyPages = 0;
      lines.push(...pageLines);
    }
    return lines;
  }

  function buildPurchaseLineFromTooltipRow(row) {
    const rctCell = getCell(row, 1);
    const rctLink = rctCell?.querySelector('a[href]') || null;
    const supplierCell = getCell(row, 2);
    const priceInfo = splitPriceAndCurrency(getCellText(row, 4));
    const qtyReceived = getCellText(row, 3);
    const priceNumber = parseNumber(priceInfo.price);
    const qtyNumber = parseNumber(qtyReceived);

    return {
      rctNumber: textOf(rctLink?.textContent || rctCell?.textContent || ''),
      rctHref: rctLink?.getAttribute('href') || '',
      poNumber: '',
      poHref: '',
      date: getCellText(row, 5),
      supplierCode: textOf(supplierCell?.textContent || ''),
      supplier: textOf(supplierCell?.textContent || ''),
      warehouse: getCellText(row, 0),
      uom: 'Unit',
      qty: '',
      qtyReceived,
      price: priceInfo.price,
      currency: priceInfo.currency,
      subtotal: Number.isFinite(priceNumber) && Number.isFinite(qtyNumber) ? formatMoney(priceNumber * qtyNumber) : ''
    };
  }

  function getPurchaseRowsFromHtml(html) {
    const doc = parseHtml(html);
    return Array.from(doc.querySelectorAll('table tbody tr'))
      .map(row => buildPurchaseLineFromTooltipRow(row))
      .filter(line => line.rctNumber || line.supplier || line.qtyReceived || line.price);
  }

  function getNextPopulateUrl(html) {
    const doc = parseHtml(html);
    const next = Array.from(doc.querySelectorAll('a.populate[data-url]')).find(link => {
      const className = link.className || '';
      const icon = link.querySelector('i');
      return className.includes('pull-right') || icon?.className?.includes('arrow-right');
    });
    return next?.getAttribute('data-url')?.replaceAll('&amp;', '&') || '';
  }

  function extractSupplierNameFromText(text) {
    const clean = textOf(text);
    const bracketMatch = clean.match(/\[[^\]]+\]\s+(.+?)\s+Vendor\b/i);
    if (bracketMatch) return textOf(bracketMatch[1]);
    const progressMatch = clean.match(/Progress\s+(.+?)\s+Supplier address\b/i);
    if (progressMatch) return textOf(progressMatch[1]);
    return '';
  }

  function extractCurrencyFromText(text) {
    const match = textOf(text).match(/\b(GBP|EUR|USD)\b\s+Currency\b/i);
    return match ? match[1].toUpperCase() : '';
  }

  function findPoLink(doc, text) {
    const anchors = Array.from(doc.querySelectorAll('a[href]'));
    const anchor = anchors.find(a => /^PO\d+/i.test(textOf(a.textContent))) || anchors.find(a => /\/doc\/po\/|\/po\//i.test(a.getAttribute('href') || ''));
    if (anchor) return { poNumber: textOf(anchor.textContent) || 'Open PO', poHref: anchor.getAttribute('href') || '' };
    const match = textOf(text).match(/\bPO(\d{4,})\b/i);
    if (!match) return { poNumber: '', poHref: '' };
    return { poNumber: `PO${match[1]}`, poHref: `/wapp/en-gb/doc/po/${match[1]}` };
  }

  function extractSection(text, startPattern, endPattern) {
    const clean = textOf(text);
    const start = clean.search(startPattern);
    if (start < 0) return '';
    const rest = clean.slice(start);
    const end = rest.search(endPattern);
    return end >= 0 ? rest.slice(0, end) : rest;
  }

  function extractRctLineCandidates(text) {
    const section = extractSection(text, /Reference\s+UOM\s+Pricing\s+Quantity\s+Price\s+Landed Price\s+Weight\s+Total\s+Subtotal/i, /\b\d+\s+Lines\b|Create Bill|Add Linked bills|Price update suggestion/i);
    const candidates = [];
    const regex = /\b([A-Z0-9]+-[A-Z0-9]+)\s+(Unit|Case|Pack|Each|Box|Carton|Pallet)\s+\S+\s+([\d,.]+)\s+([\d,.]+)\s+[\d,.]+\s+(?:[\d,.]+\s+)?([\d,.]+)\b/gi;
    let match;
    while ((match = regex.exec(section)) !== null) {
      candidates.push({
        productCode: textOf(match[1]),
        uom: textOf(match[2]),
        qtyReceived: textOf(match[3]),
        price: textOf(match[4]).replace(/\.0+$/, ''),
        subtotal: textOf(match[5])
      });
    }
    return candidates;
  }

  function extractPoLineCandidates(text) {
    const section = extractSection(text, /Part\s+Description\s+UOM\s+Supplier Reference\s+Qty\s+Price\s+Discount\s+VAT\s+Subtotal\s+Received\s+Landed Price/i, /\b\d+\s+Lines\b|Remove Selected|Create Bill|Update ETA|Backorder|Create SO/i);
    const candidates = [];
    const regex = /\b(?:[\d,.]+\s+)?([A-Z0-9]+-[A-Z0-9]+)\s+\S+\s+(.+?)\s+(Unit|Case|Pack|Each|Box|Carton|Pallet)\s+\S+\s+([\d,.]+)\s+([\d,.]+)\s+[\d,.]+\s+[\d,.]+\s+([\d,.]+)\s+([\d,.]+)/gi;
    let match;
    while ((match = regex.exec(section)) !== null) {
      candidates.push({
        productCode: textOf(match[1]),
        description: textOf(match[2]),
        uom: textOf(match[3]),
        qty: textOf(match[4]),
        price: textOf(match[5]),
        subtotal: textOf(match[6]),
        qtyReceived: textOf(match[7])
      });
    }
    return candidates;
  }

  function chooseBestRctLine(candidates, baseLine) {
    if (!candidates.length) return null;
    return candidates.find(candidate => numbersClose(candidate.qtyReceived, baseLine.qtyReceived) && numbersClose(candidate.price, baseLine.price) && numbersClose(candidate.subtotal, baseLine.subtotal)) ||
      candidates.find(candidate => numbersClose(candidate.qtyReceived, baseLine.qtyReceived) && numbersClose(candidate.price, baseLine.price)) ||
      candidates.find(candidate => numbersClose(candidate.subtotal, baseLine.subtotal)) ||
      candidates[0];
  }

  function chooseBestPoLine(candidates, rctLine, baseLine) {
    if (!candidates.length) return null;
    if (rctLine?.productCode) {
      const byProduct = candidates.find(candidate => candidate.productCode === rctLine.productCode);
      if (byProduct) return byProduct;
    }
    return candidates.find(candidate => numbersClose(candidate.qtyReceived, baseLine.qtyReceived) && numbersClose(candidate.price, baseLine.price) && numbersClose(candidate.subtotal, baseLine.subtotal)) ||
      candidates.find(candidate => numbersClose(candidate.qty, baseLine.qtyReceived) && numbersClose(candidate.price, baseLine.price)) ||
      candidates[0];
  }

  function extractPurchaseDocInfo(html, baseLine) {
    const doc = parseHtml(html);
    const bodyText = textOf(doc.body?.textContent || '');
    const poLink = findPoLink(doc, bodyText);
    const rctLine = chooseBestRctLine(extractRctLineCandidates(bodyText), baseLine);
    const poLine = chooseBestPoLine(extractPoLineCandidates(bodyText), rctLine, baseLine);
    return {
      supplier: extractSupplierNameFromText(bodyText),
      poNumber: poLink.poNumber,
      poHref: poLink.poHref,
      currency: extractCurrencyFromText(bodyText),
      rctLine,
      poLine
    };
  }

  async function enrichPurchaseLine(line) {
    if (!line.rctHref) return line;
    try {
      const info = extractPurchaseDocInfo(await fetchHtml(line.rctHref), line);
      const chosenLine = info.rctLine || info.poLine || null;
      const qtyReceived = chosenLine?.qtyReceived || line.qtyReceived;
      const qty = info.poLine?.qty || '';
      const price = chosenLine?.price || info.poLine?.price || line.price;
      const currency = info.currency || line.currency;
      const uom = chosenLine?.uom || info.poLine?.uom || line.uom || 'Unit';
      const priceNumber = parseNumber(price);
      const qtyNumber = parseNumber(qtyReceived);
      return {
        ...line,
        poNumber: info.poNumber || line.poNumber,
        poHref: info.poHref || line.poHref,
        supplier: info.supplier || line.supplier,
        uom,
        qty,
        qtyReceived,
        price,
        currency,
        subtotal: chosenLine?.subtotal || (Number.isFinite(priceNumber) && Number.isFinite(qtyNumber) ? formatMoney(priceNumber * qtyNumber) : line.subtotal)
      };
    } catch (err) {
      console.warn('Failed to enrich Purchase/Receipt row', { line, err });
      return line;
    }
  }

  async function fetchPurchaseTooltipLines(productId) {
    const lines = [];
    const seenUrls = new Set();
    let url = purchaseTooltipUrl(productId);
    for (let page = 0; page <= MAX_PO_TOOLTIP_PAGES && url && !seenUrls.has(url); page += 1) {
      seenUrls.add(url);
      const html = await fetchHtml(url);
      lines.push(...getPurchaseRowsFromHtml(html));
      const nextUrl = getNextPopulateUrl(html);
      url = nextUrl ? new URL(nextUrl, location.origin).pathname + new URL(nextUrl, location.origin).search : '';
    }
    return mapWithConcurrency(lines, PO_ENRICH_CONCURRENCY, line => enrichPurchaseLine(line));
  }

  function dedupeLines(lines, keys) {
    const seen = new Set();
    return lines.filter(line => {
      const key = keys.map(keyName => line[keyName] || '').join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function dedupeSoLines(lines) {
    return dedupeLines(lines, ['soHref', 'soNumber', 'date', 'customer', 'uom', 'qtyRequested', 'qtyConfirmed', 'pack', 'invoiced', 'price', 'subtotal']);
  }

  function dedupePoLines(lines) {
    return dedupeLines(lines, ['rctHref', 'rctNumber', 'poHref', 'poNumber', 'date', 'supplier', 'warehouse', 'uom', 'qty', 'qtyReceived', 'price', 'currency', 'subtotal']);
  }

  function sortLines(lines, key, direction) {
    const dir = direction === 'desc' ? -1 : 1;
    return [...lines].sort((a, b) => {
      let av = a[key] || '';
      let bv = b[key] || '';
      if (key === 'date') {
        av = parseTradePegDate(av);
        bv = parseTradePegDate(bv);
        return (av - bv) * dir;
      }
      if (['qtyRequested', 'qtyConfirmed', 'qty', 'qtyReceived', 'pack', 'invoiced', 'price', 'subtotal'].includes(key)) {
        av = parseNumber(av);
        bv = parseNumber(bv);
        if (!Number.isFinite(av)) av = 0;
        if (!Number.isFinite(bv)) bv = 0;
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }

  function renderMaybeBlank(value) { return value ? escapeHtml(value) : '<span class="tp-product-muted">-</span>'; }
  function renderLinkOrBlank(label, href) { return label ? (href ? `<a href="${escapeHtml(href)}" target="_blank">${escapeHtml(label)}</a>` : escapeHtml(label)) : '<span class="tp-product-muted">-</span>'; }
  function sortableHeader(label, key, currentKey, currentDirection) { const active = key === currentKey; const arrow = active ? (currentDirection === 'desc' ? ' ▼' : ' ▲') : ''; return `<th class="tp-product-sortable" data-sort-key="${escapeHtml(key)}">${escapeHtml(label)}${arrow}</th>`; }
  function csvEscape(value) { const text = String(value || ''); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
  function buildCsv(headers, rows) { return [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n'); }

  function buildSoCsv(lines) {
    const headers = ['SO Number', 'Date', 'Customer', 'UOM', 'QTY Requested', 'QTY Confirmed', 'Pack', 'Invoiced', 'Price', 'Subtotal'];
    const rows = lines.map(line => [line.soNumber, line.date, line.customer, line.uom, line.qtyRequested, line.qtyConfirmed, line.pack, line.invoiced, line.price, line.subtotal]);
    return buildCsv(headers, rows);
  }

  function buildPoCsv(lines) {
    const headers = ['RCT Number', 'PO Number', 'Date', 'Supplier', 'Warehouse', 'UOM', 'QTY', 'QTY Received', 'Price', 'Currency', 'Subtotal'];
    const rows = lines.map(line => [line.rctNumber, line.poNumber, line.date, line.supplier, line.warehouse, line.uom, line.qty, line.qtyReceived, line.price, line.currency, line.subtotal]);
    return buildCsv(headers, rows);
  }

  function downloadCsv(filename, csv) {
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 0);
  }

  function safeFilenamePart(value) { return String(value || '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80); }

  function buildSoProductLineTable(lines, productId, sortKey = 'date', sortDirection = 'desc') {
    const uniqueLines = sortLines(dedupeSoLines(lines), sortKey, sortDirection);
    if (!uniqueLines.length) { window.__tpProductSoLines = window.__tpProductSoLines || {}; window.__tpProductSoLines[productId] = []; return '<div class="tp-product-doc-status">No matching Sales Order item lines were found in the sales drilldown.</div>'; }
    window.__tpProductSoLines = window.__tpProductSoLines || {}; window.__tpProductSoLines[productId] = uniqueLines;
    const rowsHtml = uniqueLines.map(line => `<tr><td>${renderLinkOrBlank(line.soNumber, line.soHref)}</td><td>${renderMaybeBlank(line.date)}</td><td>${renderMaybeBlank(line.customer)}</td><td>${renderMaybeBlank(line.uom)}</td><td>${renderMaybeBlank(line.qtyRequested)}</td><td>${renderMaybeBlank(line.qtyConfirmed)}</td><td>${renderMaybeBlank(line.pack)}</td><td>${renderMaybeBlank(line.invoiced)}</td><td>${renderMaybeBlank(line.price)}</td><td>${renderMaybeBlank(line.subtotal)}</td></tr>`).join('');
    return `<div class="table-responsive"><table class="table table-striped table-hover table-condensed tp-product-line-table" data-product-id="${escapeHtml(productId)}" data-sort-key="${escapeHtml(sortKey)}" data-sort-direction="${escapeHtml(sortDirection)}"><thead><tr>${sortableHeader('SO Number', 'soNumber', sortKey, sortDirection)}${sortableHeader('Date', 'date', sortKey, sortDirection)}${sortableHeader('Customer', 'customer', sortKey, sortDirection)}${sortableHeader('UOM', 'uom', sortKey, sortDirection)}${sortableHeader('QTY Requested', 'qtyRequested', sortKey, sortDirection)}${sortableHeader('QTY Confirmed', 'qtyConfirmed', sortKey, sortDirection)}${sortableHeader('Pack', 'pack', sortKey, sortDirection)}${sortableHeader('Invoiced', 'invoiced', sortKey, sortDirection)}${sortableHeader('Price', 'price', sortKey, sortDirection)}${sortableHeader('Subtotal', 'subtotal', sortKey, sortDirection)}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  }

  function buildPoReceiptTable(lines, productId, sortKey = 'date', sortDirection = 'desc') {
    const uniqueLines = sortLines(dedupePoLines(lines), sortKey, sortDirection);
    if (!uniqueLines.length) { window.__tpProductPoLines = window.__tpProductPoLines || {}; window.__tpProductPoLines[productId] = []; return '<div class="tp-product-doc-status">No purchase/receipt history rows were found for this product.</div>'; }
    window.__tpProductPoLines = window.__tpProductPoLines || {}; window.__tpProductPoLines[productId] = uniqueLines;
    const rowsHtml = uniqueLines.map(line => `<tr><td>${renderLinkOrBlank(line.rctNumber, line.rctHref)}</td><td>${renderLinkOrBlank(line.poNumber, line.poHref)}</td><td>${renderMaybeBlank(line.date)}</td><td>${renderMaybeBlank(line.supplier)}</td><td>${renderMaybeBlank(line.warehouse)}</td><td>${renderMaybeBlank(line.uom)}</td><td>${renderMaybeBlank(line.qty)}</td><td>${renderMaybeBlank(line.qtyReceived)}</td><td>${renderMaybeBlank(line.price)}</td><td>${renderMaybeBlank(line.currency)}</td><td>${renderMaybeBlank(line.subtotal)}</td></tr>`).join('');
    return `<div class="table-responsive"><table class="table table-striped table-hover table-condensed tp-product-line-table" data-product-id="${escapeHtml(productId)}" data-sort-key="${escapeHtml(sortKey)}" data-sort-direction="${escapeHtml(sortDirection)}"><thead><tr>${sortableHeader('RCT Number', 'rctNumber', sortKey, sortDirection)}${sortableHeader('PO Number', 'poNumber', sortKey, sortDirection)}${sortableHeader('Date', 'date', sortKey, sortDirection)}${sortableHeader('Supplier', 'supplier', sortKey, sortDirection)}${sortableHeader('Warehouse', 'warehouse', sortKey, sortDirection)}${sortableHeader('UOM', 'uom', sortKey, sortDirection)}${sortableHeader('QTY', 'qty', sortKey, sortDirection)}${sortableHeader('QTY Received', 'qtyReceived', sortKey, sortDirection)}${sortableHeader('Price', 'price', sortKey, sortDirection)}${sortableHeader('Currency', 'currency', sortKey, sortDirection)}${sortableHeader('Subtotal', 'subtotal', sortKey, sortDirection)}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  }

  function hookTableSorting(results, productId, kind) {
    results.querySelectorAll('.tp-product-sortable').forEach(header => {
      if (header.dataset.tpSortBound === '1') return;
      header.dataset.tpSortBound = '1';
      header.addEventListener('click', () => {
        const table = header.closest('table');
        const currentKey = table?.dataset.sortKey || 'date';
        const currentDirection = table?.dataset.sortDirection || 'desc';
        const nextKey = header.dataset.sortKey;
        const nextDirection = nextKey === currentKey ? (currentDirection === 'desc' ? 'asc' : 'desc') : (nextKey === 'date' ? 'desc' : 'asc');
        if (kind === 'so') {
          const lines = window.__tpProductSoRawLines?.[productId] || [];
          results.innerHTML = buildSoProductLineTable(lines, productId, nextKey, nextDirection);
        } else {
          const lines = window.__tpProductPoRawLines?.[productId] || [];
          results.innerHTML = buildPoReceiptTable(lines, productId, nextKey, nextDirection);
        }
        hookTableSorting(results, productId, kind);
      });
    });
  }

  async function loadPane(pane, productId, force) {
    if (!force && pane.dataset.tpProductDocLoaded === '1') return;
    if (pane.dataset.tpProductDocLoaded === 'loading') return;
    const kind = pane.dataset.tpProductDocKind;
    const results = pane.querySelector('.tp-product-doc-results');
    pane.dataset.tpProductDocLoaded = 'loading';
    results.innerHTML = '<div class="tp-product-doc-status"><i class="fa fa-spinner fa-spin"></i>&nbsp;Loading...</div>';
    try {
      if (kind === 'so') {
        const lines = await fetchSalesDrilldownLines(productId);
        window.__tpProductSoRawLines = window.__tpProductSoRawLines || {};
        window.__tpProductSoRawLines[productId] = lines;
        results.innerHTML = buildSoProductLineTable(lines, productId, 'date', 'desc');
        hookTableSorting(results, productId, 'so');
      } else if (kind === 'po') {
        results.innerHTML = '<div class="tp-product-doc-status"><i class="fa fa-spinner fa-spin"></i>&nbsp;Loading purchase/receipt rows and enriching from RCT/PO documents...</div>';
        const lines = await fetchPurchaseTooltipLines(productId);
        window.__tpProductPoRawLines = window.__tpProductPoRawLines || {};
        window.__tpProductPoRawLines[productId] = lines;
        results.innerHTML = buildPoReceiptTable(lines, productId, 'date', 'desc');
        hookTableSorting(results, productId, 'po');
      } else {
        const html = await fetchHtml(dataUrl(kind, productId));
        results.innerHTML = html || '<div class="tp-product-doc-status">No results returned.</div>';
      }
      pane.dataset.tpProductDocLoaded = '1';
      if (typeof window.afterAjax === 'function') window.afterAjax();
    } catch (err) {
      console.warn('Product document list load failed', { kind, productId, err });
      pane.dataset.tpProductDocLoaded = '0';
      results.innerHTML = `<div class="tp-product-doc-status text-danger">Failed to load ${kind === 'so' ? 'Sales Order drilldown' : 'Purchase/Receipt'} results.</div>`;
    }
  }

  function hookTabLoad(productId) {
    if (document.body.dataset.tpProductDocTabHooked === '1') return;
    document.body.dataset.tpProductDocTabHooked = '1';
    document.addEventListener('shown.bs.tab', event => {
      const target = event.target?.getAttribute('href');
      if (!target) return;
      const pane = document.querySelector(target);
      if (!pane || !pane.dataset.tpProductDocKind) return;
      loadPane(pane, productId, false);
    });
    if (window.jQuery) {
      window.jQuery(document).on('shown.bs.tab', 'a[data-toggle="tab"]', function () {
        const target = this.getAttribute('href');
        const pane = target ? document.querySelector(target) : null;
        if (pane && pane.dataset.tpProductDocKind) loadPane(pane, productId, false);
      });
    }
  }

  function findSalesStatsTab(tabs) {
    return Array.from(tabs.querySelectorAll('li')).find(li => {
      const text = li.textContent.trim().replace(/\s+/g, ' ').toLowerCase();
      const href = li.querySelector('a')?.getAttribute('href') || '';
      return text === 'sales stats' || href.includes('tab_sales_stats');
    });
  }

  function install() {
    const productId = getProductId();
    if (!productId) return false;
    const tabs = document.querySelector('#part-tabs');
    const tabContent = document.querySelector('.tabpanel .tab-content');
    if (!tabs || !tabContent) return false;
    const alreadyInstalled = document.getElementById('tab_product_sales_orders') || document.getElementById('tab_product_purchase_orders');
    if (alreadyInstalled) { hookTabLoad(productId); return true; }
    injectStyles();
    const soTab = createTab('tab_product_sales_orders', 'Sales Order');
    const poTab = createTab('tab_product_purchase_orders', 'Purchase/Receipt');
    const salesStatsTab = findSalesStatsTab(tabs);
    if (salesStatsTab) {
      salesStatsTab.insertAdjacentElement('afterend', poTab);
      salesStatsTab.insertAdjacentElement('afterend', soTab);
    } else {
      tabs.appendChild(soTab);
      tabs.appendChild(poTab);
    }
    tabContent.appendChild(createPane('tab_product_sales_orders', 'so', 'Sales Order', productId));
    tabContent.appendChild(createPane('tab_product_purchase_orders', 'po', 'Purchase/Receipt', productId));
    hookTabLoad(productId);
    console.log('TradePeg Product Sales Drilldown SO/PO Tabs installed', { productId });
    return true;
  }

  function scheduleInstallRetry() {
    if (installRetryTimer) return;
    if (installRetryCount >= MAX_INSTALL_RETRIES) return;
    installRetryTimer = setTimeout(() => {
      installRetryTimer = null;
      installRetryCount += 1;
      if (!install()) scheduleInstallRetry();
    }, INSTALL_RETRY_DELAY_MS);
  }

  function installOrRetry() { if (!install()) scheduleInstallRetry(); }

  function start() {
    installOrRetry();
    setTimeout(installOrRetry, 500);
    setTimeout(installOrRetry, 1000);
    setTimeout(installOrRetry, 1500);
    setTimeout(installOrRetry, 3000);
    let mutationTimer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(installOrRetry, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
