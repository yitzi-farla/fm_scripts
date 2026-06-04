// ==UserScript==
// @name         Farla 03 - Batch Report Download with Locations
// @namespace    farla-office-scripts
// @version      1.0.0
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
          batchLocationRows = await getBatchLocationRows(productId);
        } catch (err) {
          console.warn('[Farla 03] Could not load batch details for product:', productId, err);
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

  async function getBatchLocationRows(productId) {
    const url = '/wapp/en-gb/inventory/products/batch-details/' + encodeURIComponent(productId);

    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'text/html, */*; q=0.01'
      }
    });

    if (!response.ok) {
      throw new Error('Could not load batch details. HTTP ' + response.status);
    }

    const html = await response.text();
    return parseHtmlTables(html);
  }

  function parseHtmlTables(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const tables = Array.from(doc.querySelectorAll('table'));
    const rows = [];

    for (const table of tables) {
      const headers = getTableHeaders(table);
      if (!headers.length) continue;

      const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
      const sourceRows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll('tr')).slice(1);

      for (const tr of sourceRows) {
        const cells = Array.from(tr.querySelectorAll('td'));
        if (!cells.length) continue;

        const row = {};
        headers.forEach(function (header, index) {
          row[header] = cleanText(cells[index] ? cells[index].innerText || cells[index].textContent : '');
        });

        if (Object.values(row).some(function (value) { return value !== ''; })) {
          rows.push(row);
        }
      }
    }

    return rows;
  }

  function getTableHeaders(table) {
    let headers = Array.from(table.querySelectorAll('thead th')).map(function (th) {
      return cleanText(th.innerText || th.textContent);
    });

    if (!headers.length) {
      const firstRow = table.querySelector('tr');
      if (firstRow) {
        headers = Array.from(firstRow.querySelectorAll('th,td')).map(function (cell) {
          return cleanText(cell.innerText || cell.textContent);
        });
      }
    }

    return headers.filter(Boolean);
  }

  function findMatchingLocationRows(expiringRow, locationRows) {
    const wantedBatch = cleanCompare(expiringRow.BatchNumber);
    const wantedBatchId = cleanCompare(expiringRow.BatchID);

    return locationRows.filter(function (row) {
      const rowBatch =
        getAny(row, ['Batch', 'Batch Number', 'Batch No', 'BatchNumber', 'Lot', 'Lot Number', 'LOT']) ||
        '';

      const rowBatchId =
        getAny(row, ['Batch ID', 'BatchID', 'ID']) ||
        '';

      if (wantedBatchId && cleanCompare(rowBatchId) === wantedBatchId) return true;
      if (wantedBatch && cleanCompare(rowBatch) === wantedBatch) return true;

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
      'Warehouse': getAny(locationRow, ['Warehouse', 'Warehouse Name', 'Wh', 'WH']) || '',
      'Bin / Location': getAny(locationRow, ['Bin', 'BIN', 'Location', 'Bin Location', 'BINLocation']) || '',
      'Location On Hand': getAny(locationRow, ['On Hand', 'OnHand', 'Qty', 'Quantity', 'Stock']) || '',
      'Location Sellable': getAny(locationRow, ['Sellable', 'Available', 'Free Stock']) || '',
      'Report On Hand': cleanNumber(expiringRow.OnHand),
      'Report Sellable': cleanNumber(expiringRow.Sellable),
      'ProductID': expiringRow.ProductID || '',
      'BatchID': expiringRow.BatchID || '',
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

  function getAny(row, keys) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row, key) && cleanText(row[key]) !== '') {
        return cleanText(row[key]);
      }
    }

    const normalizedWanted = keys.map(normalizeHeader);
    for (const actualKey of Object.keys(row)) {
      if (normalizedWanted.includes(normalizeHeader(actualKey)) && cleanText(row[actualKey]) !== '') {
        return cleanText(row[actualKey]);
      }
    }

    return '';
  }

  function normalizeHeader(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function cleanCompare(value) {
    return cleanText(value).toLowerCase();
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
    version: '1.0.0'
  };
})();
