// ==UserScript==
// @name         Farla 03 - Batch Report Download with Locations
// @namespace    farla-office-scripts
// @version      1.0.1
// @description  Adds a "Download with Locations" export button to the TradePeg Batch Report.
// @match        https://farla2.tradepeg.net/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/03.user.js
// @downloadURL  https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/03.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_ID = 'farla-batch-report-locations-export';
  const BUTTON_ID = 'farla-download-with-locations';
  const BATCH_REPORT_PATH = '/wapp/en-gb/reports/inventory/batches';

  function isBatchReportPage() {
    return window.location.pathname === BATCH_REPORT_PATH ||
      !!document.querySelector('#ref_form input[name="gridName"][value="batches-report"]');
  }

  function init() {
    if (!isBatchReportPage()) return;
    injectButton();
  }

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const scheduleButton = document.querySelector('#report-results .btn-schedule');
    if (!scheduleButton) return;

    const holder = scheduleButton.parentElement;
    if (!holder) return;

    const button = document.createElement('a');
    button.id = BUTTON_ID;
    button.href = '#';
    button.className = 'btn btn-default btn-sm';
    button.innerHTML = '<i class="fa fa-map-marker"></i>&nbsp;Download with Locations';

    button.addEventListener('click', function (event) {
      event.preventDefault();
      downloadWithLocations(button).catch(function (err) {
        console.error('[Farla 03] Download with Locations failed:', err);
        alert('Download with Locations failed: ' + (err && err.message ? err.message : err));
      });
    });

    holder.insertBefore(button, scheduleButton);
  }

  async function downloadWithLocations(button) {
    setButtonBusy(button, true, 'Preparing...');

    try {
      const reportData = await getCurrentBatchReportData();
      const reportRows = (reportData && reportData.records) || [];

      if (!reportRows.length) {
        alert('No batch report rows found. Run the report first, then try again.');
        return;
      }

      const products = groupBy(reportRows, function (row) {
        return row.ProductID;
      });

      const outputRows = [];
      let done = 0;
      const productIds = Object.keys(products).filter(Boolean);

      for (const productId of productIds) {
        done += 1;
        setButtonBusy(button, true, 'Checking ' + done + '/' + productIds.length + '...');

        const expiringRowsForProduct = products[productId];

        let batchLocationRows = [];
        try {
          batchLocationRows = await getTooltipBatchRows(productId);
        } catch (err) {
          console.warn('[Farla 03] Could not load tooltip batches for product:', productId, err);
        }

        for (const expiringRow of expiringRowsForProduct) {
          const matches = findMatchingLocationRows(expiringRow, batchLocationRows);

          if (!matches.length) {
            outputRows.push(makeOutputRow(expiringRow, null, 'No matching batch/location row found'));
            continue;
          }

          for (const match of matches) {
            outputRows.push(makeOutputRow(expiringRow, match, ''));
          }
        }
      }

      const csv = rowsToCsv(outputRows);
      downloadText(csv, makeFilename('expiring-batches-with-locations', 'csv'));
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function getCurrentBatchReportData() {
    if (
      window.grid_data_results &&
      Array.isArray(window.grid_data_results.records) &&
      window.grid_data_results.records.length
    ) {
      return window.grid_data_results;
    }

    const form = document.querySelector('#ref_form');
    if (!form) {
      throw new Error('Could not find the Batch Report form.');
    }

    const formData = new FormData(form);
    const jsonUrl = formData.get('jsonUrl') || '/wapp/en-gb/reports/grid-results/batches-report';
    const query = new URLSearchParams(formData);

    const response = await fetch(String(jsonUrl) + '?' + query.toString(), {
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01'
      }
    });

    if (!response.ok) {
      throw new Error('Could not load report JSON. HTTP ' + response.status);
    }

    return response.json();
  }

  async function getTooltipBatchRows(productId) {
    const url =
      '/wapp/en-gb/inventory/products/tooltip/' +
      encodeURIComponent(productId) +
      '/batches?r=' +
      encodeURIComponent(productId);

    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'text/html, */*; q=0.01'
      }
    });

    if (!response.ok) {
      throw new Error('Could not load product tooltip batches. HTTP ' + response.status);
    }

    const html = await response.text();
    return parseTooltipBatchHtml(html);
  }

  function parseTooltipBatchHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [];

    doc.querySelectorAll('table tbody tr').forEach(function (tr) {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (cells.length < 4) return;

      const batchLink = cells[3].querySelector('a[data-url*="/inventory/products/batch/"]');
      const batchUrl = batchLink ? batchLink.getAttribute('data-url') || '' : '';
      const batchIdMatch = batchUrl.match(/\/batch\/[^/]+\/([^/?#]+)/i);

      rows.push({
        Warehouse: cleanText(cells[0].textContent),
        OnHand: cleanQty(cells[1].textContent),
        Bin: cleanText(cells[2].textContent),
        BatchNumber: cleanText(batchLink ? batchLink.textContent : cells[3].textContent),
        BatchID: batchIdMatch ? batchIdMatch[1] : '',
        BestBeforeDate: cleanText(cells[4] ? cells[4].textContent : ''),
        Reserved: cleanText(cells[5] ? cells[5].textContent : '')
      });
    });

    return rows;
  }

  function findMatchingLocationRows(expiringRow, locationRows) {
    const wantedBatch = cleanCompare(expiringRow.BatchNumber);
    const wantedBatchId = cleanCompare(expiringRow.BatchID);

    return locationRows.filter(function (row) {
      const rowBatch = cleanCompare(row.BatchNumber);
      const rowBatchId = cleanCompare(row.BatchID);

      if (wantedBatchId && rowBatchId === wantedBatchId) return true;
      if (wantedBatch && rowBatch === wantedBatch) return true;

      return false;
    });
  }

  function makeOutputRow(expiringRow, locationRow, note) {
    locationRow = locationRow || {};

    return {
      'Product': expiringRow.PartCode || '',
      'Title': expiringRow.PartTitle || '',
      'Batch': expiringRow.BatchNumber || '',
      'Expiry Date': formatDate(expiringRow.ExpiryDate),
      'Expiry Source': expiringRow.ExiprySource || '',
      'Warehouse': locationRow.Warehouse || '',
      'Bin / Location': locationRow.Bin || '',
      'Location On Hand': locationRow.OnHand || '',
      'Location Sellable': locationRow.OnHand || '',
      'Best Before Date': locationRow.BestBeforeDate || '',
      'Reserved': locationRow.Reserved || '',
      'Report On Hand': cleanNumber(expiringRow.OnHand),
      'Report Sellable': cleanNumber(expiringRow.Sellable),
      'ProductID': expiringRow.ProductID || '',
      'BatchID': expiringRow.BatchID || '',
      'Location BatchID': locationRow.BatchID || '',
      'Note': note || ''
    };
  }

  function groupBy(rows, keyFn) {
    return rows.reduce(function (acc, row) {
      const key = keyFn(row);
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
  }

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function cleanCompare(value) {
    return cleanText(value).toLowerCase();
  }

  function cleanQty(value) {
    const text = cleanText(value);
    const match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? match[0] : text;
  }

  function cleanNumber(value) {
    if (value == null || value === '') return '';
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : String(value);
  }

  function formatDate(value) {
    if (!value) return '';

    if (window.moment) {
      return moment(value).format('DD/MM/YYYY');
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return [
      String(date.getDate()).padStart(2, '0'),
      String(date.getMonth() + 1).padStart(2, '0'),
      date.getFullYear()
    ].join('/');
  }

  function rowsToCsv(rows) {
    if (!rows.length) return '';

    const headers = Object.keys(rows[0]);
    const lines = [headers.map(csvEscape).join(',')];

    for (const row of rows) {
      lines.push(headers.map(function (header) {
        return csvEscape(row[header]);
      }).join(','));
    }

    return lines.join('\n');
  }

  function csvEscape(value) {
    const text = String(value == null ? '' : value);
    if (/[",\r\n]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }

    return text;
  }

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  function makeFilename(base, extension) {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0')
    ].join('');

    return base + '-' + stamp + '.' + extension;
  }

  function setButtonBusy(button, busy, text) {
    if (!button) return;

    if (busy) {
      button.dataset.originalHtml = button.dataset.originalHtml || button.innerHTML;
      button.classList.add('disabled');
      button.innerHTML = '<i class="fa fa-spinner fa-spin"></i>&nbsp;' + (text || 'Working...');
      return;
    }

    button.classList.remove('disabled');
    button.innerHTML = button.dataset.originalHtml || '<i class="fa fa-map-marker"></i>&nbsp;Download with Locations';
  }

  const observer = new MutationObserver(function () {
    init();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window[SCRIPT_ID] = {
    init: init,
    version: '1.0.1'
  };
})();
