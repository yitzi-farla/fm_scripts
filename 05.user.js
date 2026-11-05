// ==UserScript==
// @name         Farla 05
// @namespace    farla-office-scripts
// @version      1.6.0
// @description  Adds TradePeg inventory reports: SELECT items missing a vendor price, and SELECT items with no Backorder Timeline.
// @match        https://farla2.tradepeg.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      tpresourcesuk.blob.core.windows.net
// @connect      api-prod.tradepeg.com
// @connect      cdn-glb-iframe.tradepeg.com
// @connect      blob.core.windows.net
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/05.user.js
// @downloadURL  https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/05.user.js
// ==/UserScript==

;(function () {
  'use strict'

  const REPORT_ID = 'farla-select-vendor-price-report'
  const SELECT_TAG_ID = '4'
  const VENDOR_TEMPLATE_ID = '13'
  const VENDOR_EXPORT_TITLE = 'vendor pricing export export'
  const PAGE_SIZE = 2000
  // Item specifications live in TradePeg's iframe app: its own bearer token
  // (read off the specifications screen) and its own Pusher channels.
  const TP_API = 'https://api-prod.tradepeg.com'
  const IFRAME_ORIGIN = 'https://cdn-glb-iframe.tradepeg.com'
  const BACKORDER_COLUMN = 'Backorder Timeline'

  GM_addStyle(`
    #${REPORT_ID} .fsv-state { padding: 28px 15px; text-align: center; color: #777; }
    #${REPORT_ID} .fsv-summary { margin-left: 10px; }
    #${REPORT_ID} table { width: 100%; }
    #${REPORT_ID} th { white-space: nowrap; }
    #${REPORT_ID} .fsv-sku { font-family: Menlo, Consolas, monospace; }
    #${REPORT_ID} .fsv-toolbar { display:flex; gap:8px; align-items:center; margin-bottom:12px; }
    #${REPORT_ID} .fsv-toolbar .form-control { max-width:320px; }
    #${REPORT_ID} .fsv-reason { white-space: nowrap; }
    #${REPORT_ID} .fsv-check-filter { position:relative; }
    #${REPORT_ID} .fsv-check-menu { position:absolute; top:100%; left:0; z-index:1000; min-width:260px; max-width:360px; max-height:360px; overflow:auto; margin-top:4px; padding:10px; background:#fff; border:1px solid #ccc; border-radius:4px; box-shadow:0 6px 16px rgba(0,0,0,.18); }
    #${REPORT_ID} .fsv-check-menu label { display:block; font-weight:normal; margin:4px 0; white-space:nowrap; }
    #${REPORT_ID} .fsv-check-menu .fsv-check-actions { display:flex; gap:6px; margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #eee; }
    #${REPORT_ID} .fsv-filter-count { margin-left:5px; }
  `)

  const log = (...args) => console.info('[SELECT Vendor Price Report]', ...args)

  function canonicalSku(value) {
    return String(value ?? '')
      .replace(/\uFEFF/g, '')
      .replace(/[\u200B-\u200D\u2060]/g, '')
      .replace(/\u00A0/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase()
  }

  function wapp(path) {
    return `/wapp/${location.pathname.split('/')[2] || 'en-gb'}${path}`
  }

  async function tpFetch(path, init = {}) {
    const response = await fetch(path.startsWith('/') ? path : wapp(path), {
      credentials: 'same-origin',
      ...init,
      headers: { 'X-Requested-With': 'XMLHttpRequest', ...(init.headers || {}) },
    })
    if (!response.ok) throw new Error(`TradePeg answered ${response.status}`)
    return response
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue
      if (key === 'class') node.className = value
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
      else node.setAttribute(key, value === true ? '' : String(value))
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue
      node.append(child instanceof Node ? child : document.createTextNode(String(child)))
    }
    return node
  }

  function icon(name) {
    return el('i', { class: `fa ${name}` })
  }

  function normalizeHeader(value) {
    return String(value || '')
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  }

  function parseCsv(text) {
    const rows = []
    let row = []
    let field = ''
    let quoted = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') {
          field += '"'
          i++
        } else if (ch === '"') {
          quoted = false
        } else {
          field += ch
        }
      } else if (ch === '"') {
        quoted = true
      } else if (ch === ',') {
        row.push(field)
        field = ''
      } else if (ch === '\n') {
        row.push(field.replace(/\r$/, ''))
        rows.push(row)
        row = []
        field = ''
      } else {
        field += ch
      }
    }
    if (field.length || row.length) {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
    }
    return rows.filter(r => r.some(v => String(v).trim() !== ''))
  }

  function pickColumn(headers, candidates) {
    const normalized = headers.map(normalizeHeader)
    for (const candidate of candidates) {
      const exact = normalized.indexOf(normalizeHeader(candidate))
      if (exact >= 0) return exact
    }
    for (let i = 0; i < normalized.length; i++) {
      if (candidates.some(candidate => normalized[i].includes(normalizeHeader(candidate)))) return i
    }
    return -1
  }

  function parseProductGrid(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const table = doc.querySelector('table')
    if (!table) return { rows: [], total: 0 }

    const headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim())
    const skuIndex = pickColumn(headers, ['Reference', 'SKU', 'Product', 'Item'])
    const titleIndex = pickColumn(headers, ['Title', 'Description'])
    const brandIndex = pickColumn(headers, ['Brand'])
    const departmentIndex = pickColumn(headers, ['Department'])
    if (skuIndex < 0) throw new Error(`Could not find SKU/Reference column in Products grid. Headers: ${headers.join(', ')}`)

    const rows = []
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = [...tr.querySelectorAll(':scope > td')]
      if (!cells.length || !cells[skuIndex]) continue
      const sku = cells[skuIndex].textContent.trim()
      if (!sku) continue
      const link = cells[skuIndex].querySelector('a[href]')
      rows.push({
        sku,
        title: titleIndex >= 0 && cells[titleIndex] ? cells[titleIndex].textContent.trim() : '',
        brand: brandIndex >= 0 && cells[brandIndex] ? cells[brandIndex].textContent.trim() : '',
        department: departmentIndex >= 0 && cells[departmentIndex] ? cells[departmentIndex].textContent.trim() : '',
        href: link?.getAttribute('href') || '',
      })
    }

    const match = html.match(/items:\s*(\d+)\s*,\s*itemsOnPage:\s*(\d+)/)
    return { rows, total: match ? Number(match[1]) : rows.length }
  }

  function productRowsFromCsv(csvText, brandMap) {
    const rows = parseCsv(csvText)
    if (!rows.length) throw new Error('SELECT products export was empty.')
    const headers = rows[0]
    const refIndex = pickColumn(headers, ['Reference', 'SKU', 'Item Reference'])
    const titleIndex = pickColumn(headers, ['Title', 'Description'])
    const brandIndex = pickColumn(headers, ['Brand'])
    const departmentIndex = pickColumn(headers, ['Department'])
    if (refIndex < 0) {
      throw new Error(`Could not find Reference in SELECT products export. Headers: ${headers.join(', ')}`)
    }

    const out = []
    for (const row of rows.slice(1)) {
      const sku = String(row[refIndex] || '').trim()
      if (!sku) continue
      const key = canonicalSku(sku)
      const grid = brandMap.get(key)
      out.push({
        sku,
        title: titleIndex >= 0 ? String(row[titleIndex] || '').trim() : (grid?.title || ''),
        brand: brandIndex >= 0 ? String(row[brandIndex] || '').trim() : (grid?.brand || ''),
        department: departmentIndex >= 0 ? String(row[departmentIndex] || '').trim() : (grid?.department || ''),
        href: grid?.href || '',
      })
    }

    const unique = new Map()
    for (const row of out) unique.set(canonicalSku(row.sku), row)
    return [...unique.values()]
  }

  async function prepareSelectProducts(setStatus) {
    setStatus('Reading SELECT filter…')
    const page = await tpFetch(wapp('/inventory/products/'))
    const html = await page.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const form = doc.querySelector('form#product_index')
    if (!form) throw new Error('Could not find TradePeg product filter form.')

    const params = new URLSearchParams(new FormData(form))
    params.delete('labels')
    params.append('labels', SELECT_TAG_ID)
    params.set('tagsAll', '0')
    params.set('pagesize', String(PAGE_SIZE))
    params.set('_d', String(Date.now()))

    // Warm the filtered grid and keep its Brand/link metadata. The actual list
    // of SELECT SKUs comes from TradePeg's filtered products CSV export below.
    setStatus('Reading SELECT brands and departments…')
    const first = await tpFetch(`${wapp('/inventory/products/data')}?${params}`)
    const firstHtml = await first.text()
    const parsed = parseProductGrid(firstHtml)
    const gridRows = [...parsed.rows]
    const pages = Math.max(1, Math.ceil(parsed.total / PAGE_SIZE))
    if (pages > 1) {
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, async (_, i) => {
          const pageParams = new URLSearchParams(params)
          pageParams.set('p', String(i + 2))
          pageParams.set('_d', String(Date.now()))
          const r = await tpFetch(`${wapp('/inventory/products/data')}?${pageParams}`)
          return parseProductGrid(await r.text()).rows
        })
      )
      for (const rows of rest) gridRows.push(...rows)
    }

    const brandMap = new Map()
    for (const row of gridRows) brandMap.set(canonicalSku(row.sku), row)
    return { params, brandMap }
  }

  function waitForProductsExport(config, params, setStatus) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://ws-${config.cluster}.pusher.com/app/${config.key}?protocol=7&client=js&version=8.4.0`)
      const subscribed = new Set()
      let triggered = false
      let jobId = null
      const seen = new Map()
      const timeout = setTimeout(() => {
        try { ws.close() } catch {}
        reject(new Error('Timed out waiting for the SELECT products export.'))
      }, 300000)

      const finish = (fn, value) => {
        clearTimeout(timeout)
        try { ws.close() } catch {}
        fn(value)
      }

      const maybeFinish = data => {
        if (!data || typeof data !== 'object' || !data.url || jobId == null) return
        const pid = data.progressId ?? data.id
        if (pid != null && String(pid) === String(jobId)) {
          setStatus('SELECT products export ready…')
          finish(resolve, String(data.url))
        }
      }

      const trigger = async () => {
        if (triggered) return
        triggered = true
        try {
          setStatus('Downloading SELECT-tagged items…')
          const exportParams = new URLSearchParams(params)
          exportParams.delete('p')
          exportParams.set('export', 'xlsx')
          exportParams.set('columns', '0')
          exportParams.set('_d', String(Date.now()))
          const response = await tpFetch(`${wapp('/inventory/products/data')}?${exportParams}`)
          const data = await response.json()
          if (!data?.success || data?.data == null) {
            throw new Error(data?.message || 'TradePeg refused the SELECT products export.')
          }
          jobId = data.data
          const prior = seen.get(String(jobId))
          if (prior) maybeFinish(prior)
        } catch (error) {
          finish(reject, error)
        }
      }

      ws.onerror = () => finish(reject, new Error('Could not connect to TradePeg export notifications.'))
      ws.onmessage = event => {
        let msg
        try { msg = JSON.parse(event.data) } catch { return }
        let data = msg.data
        if (typeof data === 'string') {
          try { data = JSON.parse(data) } catch {}
        }
        if (msg.event === 'pusher:connection_established') {
          for (const channel of config.channels) ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel } }))
          return
        }
        if (msg.event === 'pusher_internal:subscription_succeeded') {
          subscribed.add(msg.channel)
          if (config.channels.every(ch => subscribed.has(ch))) void trigger()
          return
        }
        if (msg.event === 'file_progress' && data && typeof data === 'object') {
          const pid = data.progressId ?? data.id
          if (pid != null) seen.set(String(pid), data)
          maybeFinish(data)
        }
      }
    })
  }

  async function fetchSelectProducts(config, setStatus) {
    const { params, brandMap } = await prepareSelectProducts(setStatus)
    const productUrl = await waitForProductsExport(config, params, setStatus)
    setStatus('Reading SELECT products export…')
    const csv = await gmGetText(productUrl, 'SELECT products')
    return productRowsFromCsv(csv, brandMap)
  }

  function pusherConfig() {
    const html = document.documentElement.innerHTML
    const match = html.match(/initPusher\(\s*\[([^\]]+)\]\s*,\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]\s*\)/)
    if (!match) throw new Error('Could not read TradePeg Pusher configuration from this page.')
    const channels = [...match[1].matchAll(/['\"]([^'\"]+)['\"]/g)].map(m => m[1])
    if (!channels.length) throw new Error('TradePeg Pusher channel list is empty.')
    return { channels, key: match[2], cluster: match[3] }
  }

  function waitForVendorExport(config, setStatus) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://ws-${config.cluster}.pusher.com/app/${config.key}?protocol=7&client=js&version=8.4.0`)
      const subscribed = new Set()
      let triggered = false
      const timeout = setTimeout(() => {
        try { ws.close() } catch {}
        reject(new Error('Timed out waiting for the TradePeg Vendor Pricing export.'))
      }, 300000)

      const finish = (fn, value) => {
        clearTimeout(timeout)
        try { ws.close() } catch {}
        fn(value)
      }

      const trigger = async () => {
        if (triggered) return
        triggered = true
        try {
          setStatus('Starting Vendor Pricing export…')
          await tpFetch(wapp(`/data/exporter-request/${VENDOR_TEMPLATE_ID}`))
          const body = new URLSearchParams({
            concept: 'data-export-request',
            templateId: VENDOR_TEMPLATE_ID,
            baseId: '',
            query: '',
          })
          const response = await tpFetch(wapp('/io/post/'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body,
          })
          const data = await response.json()
          if (!data?.success) throw new Error(data?.message || 'TradePeg refused the Vendor Pricing export.')
          setStatus('Vendor Pricing export queued…')
        } catch (error) {
          finish(reject, error)
        }
      }

      ws.onerror = () => finish(reject, new Error('Could not connect to TradePeg export notifications.'))
      ws.onmessage = event => {
        let msg
        try { msg = JSON.parse(event.data) } catch { return }
        let data = msg.data
        if (typeof data === 'string') {
          try { data = JSON.parse(data) } catch {}
        }

        if (msg.event === 'pusher:connection_established') {
          for (const channel of config.channels) {
            ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel } }))
          }
          return
        }

        if (msg.event === 'pusher_internal:subscription_succeeded') {
          subscribed.add(msg.channel)
          if (config.channels.every(ch => subscribed.has(ch))) void trigger()
          return
        }

        if (msg.event === 'file_progress' && data && typeof data === 'object') {
          const title = String(data.title || '').trim().toLowerCase()
          const url = String(data.url || '')
          if (url && url.includes('/emailexport/') && title === VENDOR_EXPORT_TITLE) {
            setStatus('Vendor Pricing export ready…')
            finish(resolve, url)
          }
        }
      }
    })
  }

  async function browserGetText(url, label) {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      mode: 'cors',
    })
    if (!response.ok) throw new Error(`${label} download returned ${response.status}`)
    return response.text()
  }

  function gmGetText(url, label = 'Vendor Pricing') {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        fn(value)
      }

      // Prefer Tampermonkey's cross-origin request when its host permission is
      // already granted. Farla 05 started life as a placeholder, so existing
      // subscribers may not have approved the later Azure @connect permission.
      // In that case the signed Azure URL is also tried with ordinary CORS fetch,
      // allowing the script to remain an automatic update rather than requiring
      // a reinstall just to approve metadata.
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: true,
        timeout: 120000,
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            finish(resolve, response.responseText)
            return
          }
          browserGetText(url, label).then(
            text => finish(resolve, text),
            () => finish(reject, new Error(`${label} download returned ${response.status}`))
          )
        },
        onerror() {
          browserGetText(url, label).then(
            text => finish(resolve, text),
            error => finish(reject, new Error(`Could not download ${label}: ${error.message}`))
          )
        },
        ontimeout() {
          browserGetText(url, label).then(
            text => finish(resolve, text),
            () => finish(reject, new Error(`${label} download timed out.`))
          )
        },
      })
    })
  }

  function vendorPriceIndex(csvText) {
    const rows = parseCsv(csvText)
    if (!rows.length) throw new Error('Vendor Pricing export was empty.')
    const headers = rows[0]

    const skuIndex = pickColumn(headers, [
      // TradePeg Vendor Pricing template 13 uses "Identifier" for the item SKU.
      'Identifier', 'Item', 'Item Reference', 'Item SKU', 'SKU', 'Reference', 'Product', 'Product Code', 'Part Code'
    ])
    const priceIndex = pickColumn(headers, [
      // Exact template-13 header first; fallbacks are kept only for TradePeg column-name changes.
      'Buying Price', 'Vendor Price', 'Vendor price', 'Buy Price', 'Price', 'Cost', 'Unit Cost'
    ])
    const vendorIndex = pickColumn(headers, [
      'Vendor', 'Vendor Name', 'Supplier', 'Supplier Name', 'Contact'
    ])

    if (skuIndex < 0 || priceIndex < 0) {
      throw new Error(
        `Could not identify SKU and vendor-price columns in Vendor Pricing export. Headers: ${headers.join(', ')}`
      )
    }

    const bySku = new Map()
    for (const row of rows.slice(1)) {
      const sku = String(row[skuIndex] || '').trim()
      if (!sku) continue
      const key = canonicalSku(sku)
      const entry = bySku.get(key) || { rows: 0, priced: 0, blank: 0, vendors: [] }
      const price = String(row[priceIndex] || '').trim()
      entry.rows++
      if (price === '') entry.blank++
      else entry.priced++
      if (vendorIndex >= 0) {
        const vendor = String(row[vendorIndex] || '').trim()
        if (vendor && !entry.vendors.includes(vendor)) entry.vendors.push(vendor)
      }
      bySku.set(key, entry)
    }
    return bySku
  }

  function gmRequest({ method = 'GET', url, headers = {}, data }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers,
        data,
        anonymous: true,
        timeout: 120000,
        onload: response => resolve({ status: response.status, text: response.responseText || '' }),
        onerror: () => reject(new Error(`Could not reach ${new URL(url).host}`)),
        ontimeout: () => reject(new Error(`${new URL(url).host} timed out`)),
      })
    })
  }

  async function specsApi() {
    const page = await tpFetch(wapp('/inventory/products/manage/specifications'))
    const doc = new DOMParser().parseFromString(await page.text(), 'text/html')
    const iframeUrl = [...doc.querySelectorAll('iframe[src]')]
      .map(frame => frame.getAttribute('src'))
      .find(src => src.includes('cdn-glb-iframe.tradepeg.com'))
    if (!iframeUrl) throw new Error('Could not find the TradePeg specifications screen.')
    const token = new URL(iframeUrl, location.href).searchParams.get('token')
    if (!token) throw new Error('TradePeg specifications screen carried no token.')

    // Opening the iframe first mirrors what the browser does; harmless if it fails.
    try { await gmRequest({ url: iframeUrl }) } catch {}

    const headers = { Authorization: `Bearer ${token}`, Accept: '*/*', Origin: IFRAME_ORIGIN, Referer: `${IFRAME_ORIGIN}/` }
    const me = await gmRequest({ url: `${TP_API}/user/me`, headers })
    if (me.status !== 200) throw new Error(`TradePeg specifications API refused the token (${me.status}).`)
    const pusher = JSON.parse(me.text)?.data?.settings?.pusher || {}
    const config = { channels: pusher.channels || [], key: pusher.config?.key, cluster: pusher.config?.cluster }
    if (!config.channels.length || !config.key || !config.cluster) {
      throw new Error('TradePeg specifications API returned no export notifications config.')
    }
    return { headers, config }
  }

  function backorderIndex(csvText) {
    const rows = parseCsv(csvText)
    if (!rows.length) return null
    const headers = rows[0]
    const normalized = headers.map(normalizeHeader)
    const timelineIndex = normalized.indexOf(normalizeHeader(BACKORDER_COLUMN))
    const skuIndex = pickColumn(headers, ['Part code', 'Part Code', 'SKU', 'Reference', 'Identifier'])
    if (timelineIndex < 0 || skuIndex < 0) return null

    const bySku = new Map()
    for (const row of rows.slice(1)) {
      const sku = String(row[skuIndex] || '').trim()
      if (!sku) continue
      const key = canonicalSku(sku)
      const value = String(row[timelineIndex] || '').trim()
      // Keep a non-blank value if a SKU appears twice.
      if (!bySku.get(key)) bySku.set(key, value)
    }
    return bySku
  }

  // Exports from the iframe app give no job id, so any file announced on its
  // channels could be someone else's. Each one is downloaded and kept only if
  // it is the specifications export (has Part code + Backorder Timeline).
  function fetchBackorderTimelines(setStatus) {
    return specsApi().then(({ headers, config }) => new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://ws-${config.cluster}.pusher.com/app/${config.key}?protocol=7&client=js&version=8.4.0`)
      const subscribed = new Set()
      const tried = new Set()
      let triggered = false
      let done = false
      const timeout = setTimeout(() => finish(reject, new Error('Timed out waiting for the Item Specifications export.')), 300000)

      function finish(fn, value) {
        if (done) return
        done = true
        clearTimeout(timeout)
        try { ws.close() } catch {}
        fn(value)
      }

      async function trigger() {
        if (triggered) return
        triggered = true
        try {
          setStatus('Starting Item Specifications export…')
          const response = await gmRequest({
            method: 'POST',
            url: `${TP_API}/inventory/catalog/v1/specifications/export`,
            headers,
            data: '',
          })
          if (response.status >= 300) {
            throw new Error(`TradePeg refused the Item Specifications export (${response.status}).`)
          }
          setStatus('Item Specifications export queued…')
        } catch (error) {
          finish(reject, error)
        }
      }

      async function tryFile(url) {
        if (tried.has(url)) return
        tried.add(url)
        try {
          setStatus('Downloading Item Specifications…')
          const index = backorderIndex(await gmGetText(url, 'Item Specifications'))
          if (index) finish(resolve, index)
          else {
            log('ignored a file that is not the specifications export', url)
            setStatus('Item Specifications export queued…')
          }
        } catch (error) {
          log('could not read announced file', url, error)
        }
      }

      ws.onerror = () => finish(reject, new Error('Could not connect to TradePeg export notifications.'))
      ws.onmessage = event => {
        let msg
        try { msg = JSON.parse(event.data) } catch { return }
        let data = msg.data
        if (typeof data === 'string') {
          try { data = JSON.parse(data) } catch {}
        }
        if (msg.event === 'pusher:connection_established') {
          for (const channel of config.channels) ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel } }))
          return
        }
        if (msg.event === 'pusher_internal:subscription_succeeded') {
          subscribed.add(msg.channel)
          if (config.channels.every(ch => subscribed.has(ch))) void trigger()
          return
        }
        if (msg.event === 'pusher:error') {
          finish(reject, new Error(`TradePeg export notifications: ${JSON.stringify(data)}`))
          return
        }
        if (msg.event === 'file_progress' && triggered && data && typeof data === 'object' && data.url) {
          void tryFile(String(data.url))
        }
      }
    }))
  }

  function buildBackorderReport(selectProducts, timelines) {
    const missing = selectProducts.map(product => {
      const key = canonicalSku(product.sku)
      if (!timelines.has(key)) return { ...product, reason: 'Not in specifications' }
      if (!timelines.get(key)) return { ...product, reason: 'Backorder Timeline blank' }
      return null
    }).filter(Boolean)
    missing.sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }))
    return missing
  }

  function csvEscape(value) {
    const s = String(value ?? '')
    return `"${s.replace(/"/g, '""')}"`
  }

  function downloadCsv(rows, columns, filename) {
    const out = [
      columns.map(([header]) => csvEscape(header)).join(','),
      ...rows.map(row => columns.map(([, value]) => csvEscape(value(row))).join(',')),
    ].join('\n')
    const blob = new Blob([out], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function buildReport(selectProducts, vendorIndex) {
    const missing = selectProducts.map(product => {
      const vendor = vendorIndex.get(canonicalSku(product.sku))
      if (!vendor) {
        return { ...product, reason: 'No vendor pricing record', vendorRows: 0, blankRows: 0, vendors: '' }
      }
      if (vendor.priced === 0) {
        return {
          ...product,
          reason: 'Vendor price blank',
          vendorRows: vendor.rows,
          blankRows: vendor.blank,
          vendors: vendor.vendors.join(', '),
        }
      }
      return null
    }).filter(Boolean)

    missing.sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }))
    return missing
  }

  const REPORTS = [
    {
      linkId: 'farla-select-vendor-price-link',
      hash: 'select-missing-vendor-price',
      linkText: ' SELECT Missing Vendor Price',
      title: ' SELECT Items Missing Vendor Price',
      csvName: 'select-items-missing-vendor-price.csv',
      emptyText: 'All SELECT items are accounted for in Vendor Pricing with at least one non-blank Buying Price.',
      async load(setStatus) {
        const config = pusherConfig()
        const selectProducts = await fetchSelectProducts(config, setStatus)
        const vendorUrl = await waitForVendorExport(config, setStatus)
        setStatus('Downloading Vendor Pricing and comparing SELECT identifiers…')
        const index = vendorPriceIndex(await gmGetText(vendorUrl))
        return { rows: buildReport(selectProducts, index), checked: selectProducts.length }
      },
      searchText: row => `${row.vendors}`,
      headers: ['Reason', 'Vendor rows', 'Vendors'],
      cells: row => [
        el('td', { class: 'fsv-reason' },
          el('span', { class: `label ${row.vendorRows ? 'label-warning' : 'label-danger'}` }, row.reason)
        ),
        el('td', null, row.vendorRows ? `${row.vendorRows} (${row.blankRows} blank)` : '0'),
        el('td', null, row.vendors || '—'),
      ],
      csvColumns: [
        ['Vendor rows', row => row.vendorRows],
        ['Blank vendor-price rows', row => row.blankRows],
        ['Vendors', row => row.vendors],
      ],
    },
    {
      linkId: 'farla-select-backorder-timeline-link',
      hash: 'select-missing-backorder-timeline',
      linkText: ' SELECT Missing Backorder Timeline',
      title: ' SELECT Items Missing Backorder Timeline',
      csvName: 'select-items-missing-backorder-timeline.csv',
      emptyText: 'Every SELECT item has a Backorder Timeline.',
      async load(setStatus) {
        const selectProducts = await fetchSelectProducts(pusherConfig(), setStatus)
        const timelines = await fetchBackorderTimelines(setStatus)
        setStatus('Comparing SELECT items with Backorder Timelines…')
        return { rows: buildBackorderReport(selectProducts, timelines), checked: selectProducts.length }
      },
      searchText: () => '',
      headers: ['Brand', 'Department', 'Reason'],
      cells: row => [
        el('td', null, row.brand || '—'),
        el('td', null, row.department || '—'),
        el('td', { class: 'fsv-reason' },
          el('span', { class: `label ${row.reason === 'Backorder Timeline blank' ? 'label-warning' : 'label-danger'}` }, row.reason)
        ),
      ],
      csvColumns: [],
    },
  ]

  function reportPanel(report) {
    const body = el('div', { class: 'panel-body' })
    const summary = el('span', { class: 'label label-info label-normal fsv-summary', style: 'display:none' })
    const panel = el(
      'div',
      { id: REPORT_ID, class: 'panel panel-reports' },
      el('div', { class: 'panel-heading' }, el('h3', { class: 'panel-title' }, icon('fa-warning'), report.title, summary)),
      body
    )
    return { panel, body, summary }
  }

  function makeChecklistFilter(label, values, selected, iconClass, draw) {
    const button = el('button', { class: 'btn btn-default btn-sm', type: 'button' }, icon(iconClass), ` ${label}`, el('span', { class: 'badge fsv-filter-count' }, String(values.length)))
    const menu = el('div', { class: 'fsv-check-menu', style: 'display:none' })
    const wrapper = el('div', { class: 'fsv-check-filter' }, button, menu)

    const renderMenu = () => {
      menu.replaceChildren(
        el('div', { class: 'fsv-check-actions' },
          el('button', { class: 'btn btn-default btn-xs', type: 'button', onclick: () => { values.forEach(v => selected.add(v)); renderMenu(); draw() } }, 'Tick all'),
          el('button', { class: 'btn btn-default btn-xs', type: 'button', onclick: () => { selected.clear(); renderMenu(); draw() } }, 'Untick all')
        ),
        ...values.map(value => {
          const input = el('input', { type: 'checkbox' })
          input.checked = selected.has(value)
          input.addEventListener('change', () => {
            if (input.checked) selected.add(value)
            else selected.delete(value)
            draw()
          })
          return el('label', null, input, ` ${value}`)
        })
      )
    }

    button.addEventListener('click', event => {
      event.stopPropagation()
      const opening = menu.style.display === 'none'
      if (opening) renderMenu()
      menu.style.display = opening ? 'block' : 'none'
    })
    menu.addEventListener('click', event => event.stopPropagation())
    document.addEventListener('click', () => { menu.style.display = 'none' })

    return {
      wrapper,
      update: () => { button.querySelector('.fsv-filter-count').textContent = `${selected.size}/${values.length}` },
    }
  }

  const sortValues = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  async function loadReport(report, ui) {
    const setStatus = text => {
      ui.summary.style.display = 'none'
      ui.body.replaceChildren(el('div', { class: 'fsv-state' }, icon('fa-spinner fa-spin'), ` ${text}`))
    }

    try {
      const { rows, checked } = await report.load(setStatus)

      ui.summary.textContent = `${rows.length} missing · ${checked} SELECT items checked`
      ui.summary.style.display = ''

      const search = el('input', { class: 'form-control input-sm', type: 'search', placeholder: 'Filter SKU / title / brand / department…' })

      const brands = sortValues(rows.map(row => row.brand || '—'))
      const departments = sortValues(rows.map(row => row.department || '—'))
      const reasons = sortValues(rows.map(row => row.reason))
      const selectedBrands = new Set(brands)
      const selectedDepartments = new Set(departments)
      const selectedReasons = new Set(reasons)

      const passes = row =>
        selectedBrands.has(row.brand || '—') &&
        selectedDepartments.has(row.department || '—') &&
        selectedReasons.has(row.reason)

      const tbody = el('tbody')
      const table = el(
        'table',
        { class: 'table table-striped table-bordered table-hover' },
        el('thead', null, el('tr', null,
          el('th', null, 'SKU'),
          el('th', null, 'Title'),
          ...report.headers.map(h => el('th', null, h))
        )),
        tbody
      )

      const filters = []
      const draw = () => {
        const q = search.value.trim().toLowerCase()
        const shown = rows.filter(row => passes(row) &&
          (!q || `${row.sku} ${row.title} ${row.brand} ${row.department} ${row.reason} ${report.searchText(row)}`.toLowerCase().includes(q)))
        for (const filter of filters) filter.update()
        tbody.replaceChildren(...shown.map(row => el('tr', null,
          el('td', { class: 'fsv-sku' }, row.href
            ? el('a', { href: row.href, target: '_blank' }, row.sku)
            : row.sku),
          el('td', null, row.title),
          ...report.cells(row)
        )))
      }
      filters.push(
        makeChecklistFilter('Brand', brands, selectedBrands, 'fa-tags', draw),
        makeChecklistFilter('Department', departments, selectedDepartments, 'fa-sitemap', draw),
        makeChecklistFilter('Reason', reasons, selectedReasons, 'fa-filter', draw)
      )
      search.addEventListener('input', draw)
      draw()

      const csvColumns = [
        ['SKU', row => row.sku],
        ['Title', row => row.title],
        ['Brand', row => row.brand],
        ['Department', row => row.department],
        ['Reason', row => row.reason],
        ...report.csvColumns,
      ]

      ui.body.replaceChildren(
        el('div', { class: 'fsv-toolbar' },
          search,
          ...filters.map(f => f.wrapper),
          el('button', { class: 'btn btn-default btn-sm', type: 'button', onclick: () => downloadCsv(rows.filter(passes), csvColumns, report.csvName) }, icon('fa-download'), ' CSV'),
          el('button', { class: 'btn btn-success btn-sm', type: 'button', onclick: () => void loadReport(report, ui) }, icon('fa-refresh'), ' Refresh')
        ),
        rows.length ? table : el('div', { class: 'alert alert-success' }, report.emptyText)
      )
    } catch (error) {
      console.error('[SELECT Reports]', error)
      ui.body.replaceChildren(
        el('div', { class: 'alert alert-danger' }, error.message || String(error)),
        el('button', { class: 'btn btn-info btn-sm', type: 'button', onclick: () => void loadReport(report, ui) }, icon('fa-refresh'), ' Try again')
      )
    }
  }

  function install() {
    if (!location.pathname.includes('/reports/inventory')) return
    const list = document.querySelector('#report_selector_placeholder .side-list-select')
    const placeholder = document.getElementById('report_placeholder')
    if (!list || !placeholder) return

    for (const report of REPORTS) {
      if (document.getElementById(report.linkId)) continue
      const link = el('a', { href: '#', id: report.linkId, class: 'list-group-item' }, icon('fa-warning'), report.linkText)
      link.addEventListener('click', event => {
        event.preventDefault()
        for (const sibling of list.querySelectorAll('.list-group-item')) sibling.classList.remove('selected')
        link.classList.add('selected')
        const ui = reportPanel(report)
        placeholder.replaceChildren(ui.panel)
        history.replaceState(null, '', `${location.pathname}${location.search}#${report.hash}`)
        void loadReport(report, ui)
      })
      list.append(link)
      log('report added', report.hash)
    }
  }

  install()
  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    setTimeout(() => {
      queued = false
      try { install() } catch (error) { console.error('[SELECT Reports]', error) }
    }, 50)
  }).observe(document.body, { childList: true, subtree: true })
})()