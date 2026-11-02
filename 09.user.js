// ==UserScript==
// @name         Farla 09 - Forecast Planner
// @namespace    farla-office-scripts
// @version      1.8.2
// @description  Adds full-unit, months-sold and days-since-last-sale filters, presets of every choice (with updating), a Columns menu and drag-to-resize columns that are remembered, and opens a product's details as a modal, in TradePeg's forecast planner.
// @match        https://cdn-glb-iframe.tradepeg.com/reports/forecast-planner*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/09.user.js
// @downloadURL  https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/09.user.js
// ==/UserScript==

// Published as 09.user.js in yitzi-farla/fm_scripts, from which every office PC
// updates itself. Edit here, raise @version, and copy it across.

/*
 * The forecast planner is a React app in an iframe. It loads everything with
 * one POST to /reports/v1/inventory-forecast/run and draws whatever comes back,
 * so this script wraps window.fetch (before the app starts) and works on that
 * request and its response:
 *
 *  - Presets hold every choice: the report's own parameters (brand,
 *    customer, tag and department filters included) as they were sent on the
 *    last run, this script's filters, the table toolbar and summary card, and
 *    the columns. The app fills its own fields from the page URL when it
 *    starts (that is how TradePeg opens it with filters), and only then, so
 *    applying a preset puts its parameters in the URL and reloads the report.
 *    The rest of the preset is set back once the page is up. Otherwise every
 *    page load starts as TradePeg opens it.
 *  - The extra filters drop items from the response before the app sees it,
 *    so the counts, totals, CSV and Generate PO all follow them.
 *
 * Changing one of those filters re-runs the report from the last response
 * (no new request) by clicking the app's own Run forecast button.
 *
 * Days since last sale is worked out from the periods: a sale in a month is
 * taken as mid-month. With Period set to Day it is exact.
 *
 * Everything is kept in this iframe's localStorage in Chrome.
 */
;(function () {
  'use strict'

  const RUN_PATH = '/reports/v1/inventory-forecast/run'
  const API_URL = 'https://api-prod.tradepeg.com'
  const SETTINGS_KEY = 'farlaForecast.settings'
  const SAVED_KEY = 'farlaForecast.saved'
  const COLUMNS_KEY = 'farlaForecast.hiddenColumns'
  const COLUMNS_DEFAULT_KEY = 'farlaForecast.defaultHiddenColumns'
  /** Every column shows until hidden from the Columns menu or a default of your own is saved there. */
  const DEFAULT_HIDDEN = []
  const defaultHidden = () => load(COLUMNS_DEFAULT_KEY, DEFAULT_HIDDEN)
  /** Column widths dragged by hand, by header text; the rest keep the app's widths. */
  const WIDTHS_KEY = 'farlaForecast.columnWidths'
  const WIDTHS_DEFAULT_KEY = 'farlaForecast.defaultColumnWidths'
  const defaultWidths = () => load(WIDTHS_DEFAULT_KEY, {})
  /** The SKU column has no fixed width; it starts at this and takes any spare room. */
  const SKU_WIDTH = 300
  const MIN_WIDTH = 40
  const DAY = 86400000
  /** A click-triggered re-run counts as ours only this soon after we ask for it. */
  const REPLAY_WINDOW = 4000

  /** Off and empty: with no preset the report shows what TradePeg shows. */
  const DEFAULTS = {
    fullUnit: false,
    minMonths: null,
    daysMin: null,
    daysMax: null,
  }

  const load = (key, fallback) => {
    try {
      const v = JSON.parse(localStorage.getItem(key))
      return v ?? fallback
    } catch {
      return fallback
    }
  }
  const store = (key, value) => localStorage.setItem(key, JSON.stringify(value))

  // ---- presets shipped with the script --------------------------------------
  //
  // Added once (deleting one keeps it deleted). Ids are TradePeg's: brands,
  // tags and departments from its catalogue lists, contacts and the warehouse
  // from the report. A contact known only by name is looked up the first time
  // the preset runs and its ids are then kept in the preset.

  const SEEDED_KEY = 'farlaForecast.seeded'
  const SEED_PRESETS = [
    {
      name: '1 Month Forecast',
      params: [
        { name: 'items.brand', value: '262,244' }, // Behrens, Toffeln
        { name: 'items.brandExclude', value: 'true' },
        { name: 'items.department', value: '5' }, // Other Branded
        { name: 'items.tagExclude', value: '1' }, // LND
        { name: 'sales.contact', value: '4aad1c9a-8644-4c90-baaf-2b91ab41867a' }, // Astute Healthcare Ltd
        { name: 'sales.contactExclude', value: 'true' },
        { name: 'warehouseId', value: '9b7135ad-ec2d-e411-891c-da0007b0468b' }, // Main Warehouse
        { name: 'periodType', value: 'm' },
        { name: 'periodLength', value: '12' },
        { name: 'volume', value: 'c' },
        { name: 'forecastFunction', value: 'max' },
        { name: 'forecastLength', value: '1' },
        { name: 'comparison', value: 'expected2' },
      ],
      resolveContacts: ['B. Braun'],
      settings: { fullUnit: true, minMonths: 3, daysMin: 60, daysMax: null },
      hiddenColumns: ['Fcst / per'],
      columnWidths: {},
      view: {
        forecast: 'Max',
        planFor: '1',
        count: 'expected2',
        ticks: { 'planner-include-lead-time': false, 'planner-exclude-out-of-stock': false, 'planner-group-by-supplier': true },
        search: '',
        card: null,
      },
    },
  ]

  /** The first time this version runs: add the shipped presets and start from blank, as TradePeg opens the report. */
  if (!localStorage.getItem(SEEDED_KEY)) {
    const list = load(SAVED_KEY, [])
    for (const preset of SEED_PRESETS) {
      if (!list.some((p) => p.name === preset.name)) list.push({ ...preset, savedAt: new Date().toISOString() })
    }
    list.sort((a, b) => a.name.localeCompare(b.name))
    store(SAVED_KEY, list)
    localStorage.removeItem('farlaForecast.settings')
    localStorage.removeItem('farlaForecast.hiddenColumns')
    localStorage.setItem(SEEDED_KEY, '1')
  }

  let settings = { ...DEFAULTS, ...load(SETTINGS_KEY, {}) }
  let hiddenColumns = new Set(load(COLUMNS_KEY, defaultHidden()))
  let columnWidths = load(WIDTHS_KEY, defaultWidths())
  /** The last run: what we sent and what came back. */
  let lastRun = null
  let replayUntil = 0
  /** The table toolbar and summary-card choices from a preset, set once the next run has drawn. */
  let pendingView = null
  let lastStats = null
  /** The signed-in user's API token, from the app's own requests; for looking contacts up. */
  let auth = null
  /** The preset this page load started with, if any. */
  let startedWith = null
  /** Set just before the reload that applies a preset, read once when the page comes back. */
  const APPLY_KEY = 'farlaForecast.applying'
  /** Report parameters that aren't filters and stay in the URL whatever the preset. */
  const KEEP_IN_URL = ['token', 'hideBar']
  const CACHE_LIST_PATH = '/inventory/catalog/v1/cache-list'
  /** TradePeg's catalogue lists (brands, tags, departments…), as the app loaded them. */
  let catalogue = null
  /** Names of contacts the script has looked up, by id. */
  const CONTACT_NAMES_KEY = 'farlaForecast.contactNames'

  // ---- presets: storage and the default ------------------------------

  const savedFilters = () => load(SAVED_KEY, [])

  /** The URL that opens the report with these parameters and nothing else (bar the sign-in). */
  function urlFor(params) {
    const url = new URL(location.href)
    for (const key of [...url.searchParams.keys()]) if (!KEEP_IN_URL.includes(key)) url.searchParams.delete(key)
    for (const { name, value } of params) if (value != null && value !== '' && !KEEP_IN_URL.includes(name)) url.searchParams.set(name, value)
    return url
  }

  /**
   * A page load that follows Apply (which reloaded the page to get here)
   * starts from that preset; any other starts blank. Its parameters go in
   * the URL before the app reads it, so the app's own fields start filled
   * with them; nothing is run or sent for it. The rest is set as the page
   * comes up.
   */
  function startFromPreset() {
    const applying = sessionStorage.getItem(APPLY_KEY)
    sessionStorage.removeItem(APPLY_KEY)
    const entry = applying && savedFilters().find((f) => f.name === applying)
    if (!entry) return
    startedWith = entry
    settings = { ...DEFAULTS, ...entry.settings }
    if (entry.hiddenColumns) hiddenColumns = new Set(entry.hiddenColumns)
    if (entry.columnWidths) columnWidths = { ...entry.columnWidths }
    store(SETTINGS_KEY, settings)
    store(COLUMNS_KEY, [...hiddenColumns])
    store(WIDTHS_KEY, columnWidths)
    pendingView = entry.view ?? null
    history.replaceState(history.state, '', urlFor(entry.params))
  }

  // ---- fetch wrapper ----------------------------------------------------

  const realFetch = window.fetch.bind(window)

  window.fetch = async function (input, init) {
    const isRequest = input instanceof Request
    const url = isRequest ? input.url : String(input instanceof URL ? input.href : input)
    const method = ((init && init.method) || (isRequest && input.method) || 'GET').toUpperCase()
    if (url.startsWith(API_URL)) {
      try {
        auth = new Headers((init && init.headers) || (isRequest ? input.headers : undefined)).get('authorization') || auth
      } catch {}
    }

    if (url.startsWith(API_URL) && new URL(url).pathname === RUN_PATH && method === 'POST') return handleRun(input, init)
    const response = await realFetch(input, init)
    // The app's catalogue lists, to name brands, tags and departments when a preset's changes are shown.
    if (url.startsWith(API_URL) && new URL(url).pathname === CACHE_LIST_PATH && method === 'GET' && response.ok) {
      response.clone().json().then((j) => { catalogue = j?.data ?? catalogue }, () => {})
    }
    return response
  }

  async function handleRun(input, init) {
    const request = new Request(input, init)
    let body
    try {
      body = JSON.parse(await request.clone().text())
    } catch {
      return realFetch(request)
    }

    // Sent as the app has it: a preset only ever fills the app's fields.
    const params = body.parameters ?? []
    const sentBody = JSON.stringify({ ...body, parameters: params })

    let raw
    if (Date.now() < replayUntil && lastRun && lastRun.sentBody === sentBody) {
      raw = lastRun.raw
    } else {
      const response = await realFetch(new Request(request, { body: sentBody }))
      if (!response.ok) return response
      raw = await response.json()
    }
    replayUntil = 0
    lastRun = { sentBody, raw, params }

    const out = applyFilters(raw)
    setTimeout(renderStatus, 0)
    if (pendingView) {
      const view = pendingView
      pendingView = null
      // After the app has drawn this run (and reset its toolbar for it).
      setTimeout(() => applyView(view), 400)
    }
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

  /**
   * Every contact whose name contains one of the preset's names (ignoring
   * dots and spaces) joins its excluded contacts, and the preset keeps the
   * ids from then on. Returns the updated preset, or null if the lookup could
   * not be made (it is tried again next time).
   */
  async function resolveContacts(preset, token) {
    if (!token) return null
    const found = []
    const missing = []
    for (const term of preset.resolveContacts) {
      const query = term.split(/[^A-Za-z0-9]+/).sort((a, b) => b.length - a.length)[0]
      try {
        const response = await realFetch(`${API_URL}/contacts/v1/lookup?query=${encodeURIComponent(query)}`, {
          headers: { Authorization: token },
          signal: AbortSignal.timeout(6000),
        })
        if (!response.ok) return null
        const matches = ((await response.json())?.results ?? []).filter((c) => norm(c.name).includes(norm(term)))
        if (matches.length) found.push(...matches)
        else missing.push(term)
      } catch {
        return null
      }
    }
    const params = preset.params.map((p) => ({ ...p }))
    const contact = params.find((p) => p.name === 'sales.contact')
    const ids = [...new Set([...(contact?.value ? String(contact.value).split(',') : []), ...found.map((c) => c.id)])]
    if (contact) contact.value = ids.join(',')
    else params.push({ name: 'sales.contact', value: ids.join(',') })
    if (!params.some((p) => p.name === 'sales.contactExclude')) params.push({ name: 'sales.contactExclude', value: 'true' })

    const list = savedFilters()
    const stored = list.find((p) => p.name === preset.name)
    const updated = { ...(stored ?? preset), params }
    delete updated.resolveContacts
    if (stored) {
      list[list.indexOf(stored)] = updated
      store(SAVED_KEY, list)
    }
    store(CONTACT_NAMES_KEY, { ...load(CONTACT_NAMES_KEY, {}), ...Object.fromEntries(found.map((c) => [c.id, c.name])) })
    const names = found.map((c) => c.name).join(', ')
    const note = missing.length ? `No customer matching ${missing.join(', ')}` : names ? `Excluding ${names}` : ''
    if (note) sessionStorage.setItem('farlaForecast.note', note)
    setTimeout(() => message(note), 0)
    return updated
  }

  // ---- client-side filters -----------------------------------------------

  function applyFilters(raw) {
    const data = raw?.data ?? {}
    const periods = data.periods ?? []
    const end = parseDate(data.settings?.endDate) ?? Date.now()
    const daily = data.settings?.periodType === 'd'
    const items = data.items ?? []
    const hidden = { partial: 0, months: 0, days: 0 }

    const kept = items.filter((item) => {
      const sold = (item.periods ?? []).map((p) => (p?.qty ?? 0) > 0)
      if (settings.fullUnit && !((item.results?.inventoryRequired ?? 0) >= 1)) {
        hidden.partial++
        return false
      }
      if (settings.minMonths != null && sold.filter(Boolean).length < settings.minMonths) {
        hidden.months++
        return false
      }
      if (settings.daysMin != null || settings.daysMax != null) {
        const days = daysSinceSale(sold, periods, end, daily)
        if ((settings.daysMin != null && days < settings.daysMin) || (settings.daysMax != null && days > settings.daysMax)) {
          hidden.days++
          return false
        }
      }
      return true
    })

    lastStats = { total: items.length, shown: kept.length, hidden, periods: periods.length }
    return { ...raw, data: { ...data, items: kept } }
  }

  /** Periods run newest first. No sale in the window counts as infinitely long ago. */
  function daysSinceSale(sold, periods, end, daily) {
    const i = sold.indexOf(true)
    if (i < 0 || !periods[i]) return Infinity
    const start = parseDate(periods[i].start)
    const stop = parseDate(periods[i].end)
    if (start == null || stop == null) return Infinity
    const at = daily ? start : (start + stop) / 2
    return Math.max(0, Math.round((end - at) / DAY))
  }

  function parseDate(s) {
    if (!s) return null
    const t = Date.parse(String(s).replace(/\.\d+/, ''))
    return Number.isNaN(t) ? null : t
  }

  // ---- re-running --------------------------------------------------------

  function runButton() {
    return [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Run forecast')
  }

  function rerun(fromCache) {
    const button = runButton()
    if (!button) return
    replayUntil = fromCache ? Date.now() + REPLAY_WINDOW : 0
    button.click()
  }

  // ---- controls in the app's filter panel --------------------------------
  //
  // The app's own markup and Tailwind classes, so the controls look and sit
  // like the report's fields: toggles and boxes go at the end of its field
  // grid, presets go beside Run forecast.

  const TRACK = "peer relative h-3.5 w-fixed-6 rounded-full bg-gray-200 after:absolute after:start-[2px] after:top-0.5 after:h-2.5 after:w-2.5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#03c160] peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:ring-0 rtl:peer-checked:after:-translate-x-full"
  const HELP_PATH = 'M504 256c0 136.997-111.043 248-248 248S8 392.997 8 256C8 119.083 119.043 8 256 8s248 111.083 248 248zM262.655 90c-54.497 0-89.255 22.957-116.549 63.758-3.536 5.286-2.353 12.415 2.715 16.258l34.699 26.31c5.205 3.947 12.621 3.008 16.665-2.122 17.864-22.658 30.113-35.797 57.303-35.797 20.429 0 45.698 13.148 45.698 32.958 0 14.976-12.363 22.667-32.534 33.976C247.128 238.528 216 254.941 216 296v4c0 6.627 5.373 12 12 12h56c6.627 0 12-5.373 12-12v-1.333c0-28.462 83.186-29.647 83.186-106.667 0-58.002-60.165-102-116.531-102zM256 338c-25.365 0-46 20.635-46 46 0 25.364 20.635 46 46 46s46-20.636 46-46c0-25.365-20.635-46-46-46z'
  const helpIcon = (where) =>
    `<span class="relative inline-flex"><svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" class="cursor-help text-black ${where}" height="10" width="10" xmlns="http://www.w3.org/2000/svg"><path d="${HELP_PATH}"></path></svg></span>`

  const toggle = (k, text, help) => `
    <div class="w-full relative" data-ffx-cell><div class="flex h-input items-center">
      <label for="ffx-${k}" class="gap-1 fit-content relative flex items-center cursor-pointer" title="${help}">
        <input id="ffx-${k}" data-k="${k}" size="5" class="peer sr-only" type="checkbox"><div class="${TRACK}"></div>
        <span class="flex gap-1 px-1 text-xs text-tp-blue-900 dark:text-blue-200">${text}<div class="-mt-5.5">${helpIcon('absolute -top-3.5 -right-2.5')}</div></span>
      </label>
    </div></div>`

  const field = (k, text, help) => `
    <div class="w-full relative" data-ffx-cell><div class="w-full"><div class="relative" title="${help}">
      <label for="ffx-${k}" class="label-class"><p title="" class="truncate">${text}</p><div class="-mt-2.5 ml-0.5">${helpIcon('')}</div></label>
      <input id="ffx-${k}" data-k="${k}" inputmode="numeric" class="input-class rounded px-3 w-full disabled:cursor-not-allowed border" placeholder="" type="text" autocomplete="off">
    </div></div></div>`

  /** One field, two small boxes: the placeholders say which is which until there's a value. */
  const range = (min, max, text, help) => {
    const box = (k, word) =>
      `<input id="ffx-${k}" data-k="${k}" inputmode="numeric" aria-label="${text}, ${word}" placeholder="${word}" class="input-class rounded px-3 w-full disabled:cursor-not-allowed border" type="text" autocomplete="off">`
    return `
    <div class="w-full relative" data-ffx-cell><div class="w-full"><div class="relative" title="${help}">
      <label for="ffx-${min}" class="label-class"><p title="" class="truncate">${text}</p><div class="-mt-2.5 ml-0.5">${helpIcon('')}</div></label>
      <div class="ffx-range">${box(min, 'min')}<span aria-hidden="true">–</span>${box(max, 'max')}</div>
    </div></div></div>`
  }

  const CELLS = [
    toggle('fullUnit', 'Min 1 full unit', 'Hide items whose Required is under one whole unit, so no partial suggestions'),
    field('minMonths', 'Min months sold (of <span data-periods>12</span>)', 'Hide items that sold in fewer of the periods than this'),
    range('daysMin', 'daysMax', 'Days since last sale', 'Min hides items that sold more recently; max hides items whose last sale was longer ago, or that have not sold in the window. Worked out from the periods: a sale in a month counts as mid-month; exact with Period set to Day'),
  ].join('')

  const CSS = `
    .ffx-foot { display: flex; flex-direction: column; gap: 4px; margin-right: auto; min-width: 0; }
    .ffx-foot-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .ffx-foot .input-class { height: 34px; }
    .ffx-foot select.input-class { width: 220px !important; padding-right: 24px; }
    .ffx-foot input.input-class { width: 180px !important; }
    :has(> .ffx-foot) { align-items: center; gap: 12px; }
    .ffx-btn { height: 34px; padding: 0 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; font-size: 12px; font-weight: 500; color: #334155; cursor: pointer; transition: background-color .15s ease; }
    .ffx-btn:hover:not(:disabled) { background: #f8fafc; }
    .ffx-btn:disabled { opacity: .5; cursor: not-allowed; }
    .ffx-btn:focus-visible, .ffx-cols-menu :focus-visible, .ffx-cols-btn:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }

    .ffx-cols { position: relative; display: inline-flex; }
    .ffx-cols-badge { margin-left: 2px; border-radius: 9999px; background: #e0e7ff; color: #4338ca; font-size: 10px; font-weight: 600; padding: 0 6px; line-height: 16px; }
    .ffx-cols-menu { position: absolute; left: 0; top: calc(100% + 6px); z-index: 30; width: 300px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(15,23,42,.15); padding: 12px; font-size: 12px; color: #334155; text-transform: none; letter-spacing: normal; }
    .ffx-cols-menu h4 { margin: 10px 0 6px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #64748b; }
    .ffx-cols-menu h4:first-child { margin-top: 0; }
    .ffx-cols-menu label { display: flex; align-items: center; gap: 8px; margin: 0; padding: 4px 6px; border-radius: 6px; font-weight: normal; cursor: pointer; }
    .ffx-cols-menu label:hover { background: #f1f5f9; }
    .ffx-cols-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2px; }
    .ffx-cols-foot { display: flex; justify-content: space-between; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #e2e8f0; }
    .ffx-cols-foot .ffx-btn { height: 28px; }
    .ffx-cols-foot .ffx-btn:last-child { margin-left: auto; }
    .ffx-cols-tip { margin: 8px 0 0; font-size: 11px; color: #64748b; }
    .ffx-link { border: 0; background: none; padding: 0; color: #4f46e5; font-size: 11px; cursor: pointer; text-decoration: underline; }

    [data-ffx-table] .h-\\[58px\\] > :not(.sticky) { position: relative; }
    .ffx-resize { position: absolute; top: 0; right: -4px; z-index: 5; width: 8px; height: 100%; cursor: col-resize; touch-action: none; }
    .ffx-resize::after { content: ''; position: absolute; top: 20%; bottom: 20%; left: 3px; width: 2px; border-radius: 1px; background: transparent; transition: background-color .15s ease; }
    [data-ffx-table] .h-\\[58px\\] > :hover > .ffx-resize::after { background: #cbd5e1; }
    .ffx-resize:hover::after, .ffx-resize:focus-visible::after, .ffx-resizing .ffx-resize:active::after { background: #6366f1; }
    .ffx-resize:focus-visible { outline: none; }
    .ffx-resizing, .ffx-resizing * { cursor: col-resize !important; user-select: none !important; }
    .ffx-cols-msg { margin: 6px 0 0; min-height: 15px; font-size: 11px; color: #64748b; }

    .ffx-backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(15,23,42,.45); animation: ffx-fade .15s ease-out; }
    aside.w-\\[420px\\][data-ffx-modal] { position: fixed !important; inset: 16px; z-index: 41; margin: auto; width: min(760px, calc(100vw - 32px)) !important; height: fit-content !important; max-height: calc(100vh - 32px); box-shadow: 0 25px 50px -12px rgba(15,23,42,.35) !important; animation: ffx-pop .15s ease-out; }
    @media (min-width: 640px) { aside.w-\\[420px\\][data-ffx-modal] .grid-cols-3 { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
    @keyframes ffx-fade { from { opacity: 0; } }
    @keyframes ffx-pop { from { opacity: 0; transform: scale(.98); } }
    @media (prefers-reduced-motion: reduce) { .ffx-backdrop, aside.w-\\[420px\\][data-ffx-modal] { animation: none; } }
    .ffx-confirm-back { position: fixed; inset: 0; z-index: 50; background: rgba(15,23,42,.45); animation: ffx-fade .15s ease-out; }
    .ffx-confirm { position: fixed; inset: 16px; z-index: 51; margin: auto; width: min(640px, calc(100vw - 32px)); height: fit-content; max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 25px 50px -12px rgba(15,23,42,.35); padding: 18px 20px; font-size: 12px; color: #334155; animation: ffx-pop .15s ease-out; }
    .ffx-confirm h3 { margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #0f172a; }
    .ffx-confirm > p { margin: 0 0 12px; color: #64748b; }
    .ffx-confirm-scroll { min-height: 0; overflow: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
    .ffx-confirm table { width: 100%; border-collapse: collapse; }
    .ffx-confirm th, .ffx-confirm td { padding: 6px 10px; text-align: left; vertical-align: top; border-bottom: 1px solid #f1f5f9; }
    .ffx-confirm thead th { position: sticky; top: 0; background: #f8fafc; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #64748b; }
    .ffx-confirm-group th { background: #fff; padding-top: 10px; font-size: 11px; font-weight: 600; color: #047857; }
    .ffx-confirm td:first-child { width: 34%; color: #475569; }
    .ffx-confirm .ffx-was { color: #64748b; text-decoration: line-through; text-decoration-color: #cbd5e1; }
    .ffx-confirm .ffx-now { color: #0f172a; font-weight: 600; }
    .ffx-confirm .ffx-none { color: #94a3b8; font-style: italic; font-weight: normal; text-decoration: none; }
    .ffx-confirm-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
    .ffx-btn-primary { background: #03c160; border-color: #03c160; color: #fff; }
    .ffx-btn-primary:hover:not(:disabled) { background: #02a853; }
    .ffx-confirm :focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    @media (prefers-reduced-motion: reduce) { .ffx-confirm { animation: none; } }
    .ffx-range { display: flex; align-items: center; gap: 6px; }
    .ffx-range > span { color: #94a3b8; }
    .ffx-range > input::placeholder { color: #94a3b8; }
    .ffx-note { font-size: 11px; color: #64748b; }
    .ffx-note .ffx-warn { color: #b45309; }
    .ffx-sep { width: 1px; height: 22px; background: #e2e8f0; margin: 0 4px; }
  `

  const FOOT = `
    <div class="ffx-foot-row">
      <select data-saved class="input-class rounded px-3 border" title="Presets"></select>
      <button type="button" class="ffx-btn" data-act="apply" title="Fill every field with this preset; nothing runs until you click Run forecast">Apply</button>
      <button type="button" class="ffx-btn" data-act="update" title="Save everything chosen now over this preset: the report's fields (as of the last run), the extra filters, the table toolbar and summary card, and the columns">Update</button>
      <span class="ffx-sep"></span>
      <input data-name class="input-class rounded px-3 border" placeholder="Name a new preset" type="text" autocomplete="off">
      <button type="button" class="ffx-btn" data-act="save">Save as new preset</button>
      <span class="ffx-note" data-msg></span>
    </div>
    <div class="ffx-note" data-stats></div>`

  function wireInputs(root) {
    root.querySelectorAll('[data-ffx-cell] [data-k]').forEach((input) => {
      input.addEventListener('change', () => onSettingChange(input))
      if (input.type === 'text') input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur() })
    })
  }

  function onSettingChange(input) {
    const k = input.dataset.k
    if (input.type === 'checkbox') settings[k] = input.checked
    else {
      const n = parseInt(input.value, 10)
      settings[k] = Number.isNaN(n) ? null : Math.max(0, n)
      input.value = settings[k] ?? ''
    }
    store(SETTINGS_KEY, settings)
    if (lastRun) rerun(true)
  }

  function fillInputs() {
    document.querySelectorAll('[data-ffx-cell] [data-k]').forEach((input) => {
      const v = settings[input.dataset.k]
      if (input.type === 'checkbox') input.checked = !!v
      else input.value = v ?? ''
    })
  }

  const foot = () => document.querySelector('.ffx-foot')

  const selectedName = () => foot()?.querySelector('[data-saved]').value ?? ''

  function renderSaved() {
    const el = foot()
    const select = el?.querySelector('[data-saved]')
    if (!select) return
    const current = select.value
    select.innerHTML = '<option value="">Presets…</option>'
    for (const f of savedFilters()) {
      const option = document.createElement('option')
      option.value = f.name
      option.textContent = f.name
      select.append(option)
    }
    select.value = current
    renderSavedButtons()
  }

  /** The buttons that act on the chosen preset only work once one is chosen. */
  function renderSavedButtons() {
    const el = foot()
    if (!el) return
    const entry = savedFilters().find((f) => f.name === selectedName())
    for (const act of ['apply', 'update']) el.querySelector(`[data-act=${act}]`).disabled = !entry
  }

  function message(text) {
    const m = foot()?.querySelector('[data-msg]')
    if (m) m.textContent = text
  }

  // ---- the table toolbar and summary cards ----------------------------------
  //
  // These choices live only in the app (Forecast, Plan for, Count, the three
  // ticks, the search, and which summary card is picked), so they are read
  // from and set back through its own controls. Text boxes and selects are
  // React-controlled: their value is set with the browser's own setter and an
  // input/change event, which is what React listens for.

  const VIEW_TICKS = ['planner-include-lead-time', 'planner-exclude-out-of-stock', 'planner-group-by-supplier']
  const toolbar = () => document.getElementById('planner-group-by-supplier')?.closest('.rounded-xl')
  const summaryCards = () => [...document.querySelectorAll('button.min-w-\\[140px\\]')]
  const cardLabel = (card) => card.querySelector('span')?.textContent.trim()

  function readView() {
    const bar = toolbar()
    if (!bar) return null
    const ticks = {}
    for (const id of VIEW_TICKS) {
      const box = document.getElementById(id)
      if (box) ticks[id] = box.checked
    }
    return {
      forecast: [...bar.querySelectorAll('label button')].find((b) => b.classList.contains('bg-indigo-600'))?.textContent.trim() ?? null,
      planFor: bar.querySelector('input[type=number]')?.value ?? null,
      count: bar.querySelector('select')?.value ?? null,
      ticks,
      search: bar.querySelector('input[type=search]')?.value ?? '',
      card: cardLabel(summaryCards().find((c) => c.classList.contains('ring-1')) ?? document.createElement('i')) ?? null,
    }
  }

  function setControlled(el, value) {
    if (!el || value == null || el.value === String(value)) return
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value))
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  }

  /** Each step looks its control up again: the one before may have redrawn the bar. */
  function applyView(view, tries = 15) {
    if (!toolbar()) {
      if (tries) setTimeout(() => applyView(view, tries - 1), 200)
      return
    }
    if (view.forecast) {
      const button = [...toolbar().querySelectorAll('label button')].find((b) => b.textContent.trim() === view.forecast)
      if (button && !button.classList.contains('bg-indigo-600')) button.click()
    }
    setControlled(toolbar()?.querySelector('input[type=number]'), view.planFor)
    setControlled(toolbar()?.querySelector('select'), view.count)
    for (const [id, checked] of Object.entries(view.ticks ?? {})) {
      const box = document.getElementById(id)
      if (box && box.checked !== checked) box.click()
    }
    setControlled(toolbar()?.querySelector('input[type=search]'), view.search ?? '')
    if (view.card) {
      const card = summaryCards().find((c) => cardLabel(c) === view.card)
      if (card && !card.classList.contains('ring-1')) card.click()
    }
  }

  /** What a preset holds: everything chosen. The report's fields as sent on the last run, the extra filters, the table toolbar and summary card, the columns and their widths. */
  function snapshot(name, previous) {
    return {
      name,
      params: lastRun.params,
      settings: { ...settings },
      hiddenColumns: [...hiddenColumns],
      columnWidths: { ...columnWidths },
      view: readView(),
      ...(previous?.resolveContacts ? { resolveContacts: previous.resolveContacts } : {}),
      savedAt: new Date().toISOString(),
    }
  }

  function writeSaved(list, select) {
    list.sort((a, b) => a.name.localeCompare(b.name))
    store(SAVED_KEY, list)
    if (select != null) foot().querySelector('[data-saved]').value = select
    renderSaved()
  }

  function saveCurrent() {
    const el = foot()
    const name = el.querySelector('[data-name]').value.trim()
    if (!name) return message('Give the new preset a name first')
    if (!lastRun) return message('Run the forecast once, then save')
    const list = savedFilters()
    if (list.some((f) => f.name === name)) return message(`"${name}" already exists; choose it and use Update`)
    list.push(snapshot(name))
    writeSaved(list, name)
    el.querySelector('[data-name]').value = ''
    message(`Saved "${name}"`)
  }

  /** Asks first, showing each change: what the preset has, and what it would have. */
  async function updateSaved() {
    const name = selectedName()
    if (!name || document.querySelector('.ffx-confirm')) return
    if (!lastRun) return message('Run the forecast once, then update')
    const before = savedFilters().find((f) => f.name === name)
    if (!before) return
    const after = snapshot(name, before)
    const changes = presetChanges(before, after)
    if (!changes.length) return message(`Nothing to update: "${name}" already matches everything chosen now`)
    if (!(await confirmChanges(name, changes))) return message('Update cancelled')
    const list = savedFilters()
    const i = list.findIndex((f) => f.name === name)
    if (i < 0) return
    list[i] = after
    writeSaved(list, name)
    message(`Updated "${name}": ${changes.length} change${changes.length === 1 ? '' : 's'}`)
  }

  // ---- what an update would change ----------------------------------------

  const PARAM_LABELS = {
    warehouseId: 'Inventory warehouse', warehouseList: 'Sales warehouses', incSubWarehouses: 'Inc. sub warehouses',
    incDs: 'Inc. DS', incUnshort: 'Inc. All', endDate: 'End date', periodType: 'Period', periodLength: 'Length',
    volume: 'Volume', forecastFunction: 'Forecast', forecastLength: 'Forecast length', comparison: 'Inventory comparison',
    unconfirmed: 'Include unconfirmed', includeLeadTime: 'Include lead-time inventory', excludeDaysOutOfStock: 'Exclude days out of stock',
    'items.brand': 'Brands', 'items.brandExclude': 'Brands are excluded', 'items.department': 'Departments',
    'items.tag': 'Tags', 'items.tagExclude': 'Excluded tags', 'sales.contact': 'Customers', 'sales.contactExclude': 'Customers are excluded',
  }
  const PARAM_OPTIONS = {
    periodType: { m: 'Month', w: 'Week', d: 'Day' },
    volume: { c: 'Confirmed', requested: 'Requested', invoiced: 'Invoiced' },
    forecastFunction: { avg: 'Average', min: 'Min', max: 'Max', total: 'Total' },
    comparison: { available: 'Available', onHand: 'On-hand', expected: 'Available + Expected', expected2: 'Available + Expected (inc. draft)', availableOnOrder: 'Available + On Order' },
    unconfirmed: { 'order-date': 'By order date', 'dispatch-date': 'By dispatch date', 'due-date': 'By due date' },
  }
  /** Which catalogue list names the ids in each list field. */
  const PARAM_LISTS = { 'items.brand': 'itemBrands', 'items.department': 'itemDepartments', 'items.tag': 'itemTags', 'items.tagExclude': 'itemTags' }
  const SETTING_LABELS = { fullUnit: 'Min 1 full unit', minMonths: 'Min months sold', daysMin: 'Days since last sale, min', daysMax: 'Days since last sale, max' }
  const VIEW_LABELS = { forecast: 'Forecast', planFor: 'Plan for', count: 'Count', search: 'Search', card: 'Summary card' }
  const TICK_LABELS = { 'planner-include-lead-time': 'Include lead time', 'planner-exclude-out-of-stock': 'Exclude out-of-stock days', 'planner-group-by-supplier': 'Group by supplier' }
  const COUNT_OPTIONS = { available: 'Available', onHand: 'On-hand', expected: 'Available + expected', expected2: 'Available + expected (inc. draft)', availableOnOrder: 'Available + on order' }

  const blank = (v) => v == null || v === '' || v === false || v === 'false'
  const shown = (v) => (blank(v) ? '' : v === true || v === 'true' ? 'On' : String(v))

  /** A field's value as words: names for ids where they are known, option names for codes. */
  function describeParam(key, value) {
    if (blank(value)) return ''
    if (PARAM_OPTIONS[key]) return PARAM_OPTIONS[key][value] ?? String(value)
    const ids = String(value).split(',').filter(Boolean)
    if (key === 'sales.contact') {
      const names = { '4aad1c9a-8644-4c90-baaf-2b91ab41867a': 'Astute Healthcare Ltd', ...load(CONTACT_NAMES_KEY, {}) }
      const known = ids.map((id) => names[id]).filter(Boolean)
      return known.length === ids.length ? known.join(', ') : `${ids.length} customer${ids.length === 1 ? '' : 's'}${known.length ? ` (incl. ${known.join(', ')})` : ''}`
    }
    const list = catalogue?.[PARAM_LISTS[key]]
    if (list) return ids.map((id) => list.find((x) => String(x.id) === id)?.name ?? id).join(', ')
    return shown(value)
  }

  /** Each difference between a preset and what would replace it, grouped as the page groups them. */
  function presetChanges(before, after) {
    const changes = []
    const add = (group, label, from, to) => { if (from !== to) changes.push({ group, label, from, to }) }

    const asMap = (params) => Object.fromEntries((params ?? []).filter((p) => !KEEP_IN_URL.includes(p.name)).map((p) => [p.name, p.value]))
    const a = asMap(before.params)
    const b = asMap(after.params)
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      if (blank(a[key]) && blank(b[key])) continue
      add('Report filters', PARAM_LABELS[key] ?? key, describeParam(key, a[key]), describeParam(key, b[key]))
    }
    for (const key of Object.keys(SETTING_LABELS)) add('Farla filters', SETTING_LABELS[key], shown(before.settings?.[key]), shown(after.settings?.[key]))

    const va = before.view ?? {}
    const vb = after.view ?? {}
    for (const key of Object.keys(VIEW_LABELS)) {
      const say = (v) => (key === 'count' ? COUNT_OPTIONS[v] ?? shown(v) : shown(v))
      if (va[key] == null && !before.view) continue
      add('Table toolbar', VIEW_LABELS[key], say(va[key]), say(vb[key]))
    }
    for (const id of Object.keys(TICK_LABELS)) {
      if (va.ticks?.[id] == null && vb.ticks?.[id] == null) continue
      add('Table toolbar', TICK_LABELS[id], va.ticks?.[id] ? 'On' : '', vb.ticks?.[id] ? 'On' : '')
    }

    const ha = new Set(before.hiddenColumns ?? [])
    const hb = new Set(after.hiddenColumns ?? [])
    const list = (s) => [...s].join(', ')
    add('Columns', 'Hidden columns', list(ha), list(hb))
    const wa = before.columnWidths ?? {}
    const wb = after.columnWidths ?? {}
    for (const col of [...new Set([...Object.keys(wa), ...Object.keys(wb)])]) {
      add('Columns', `${col} width`, wa[col] != null ? `${wa[col]}px` : '', wb[col] != null ? `${wb[col]}px` : '')
    }
    return changes
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

  /** A small dialog listing the changes; resolves true for Update, false for Cancel, Esc or a click outside. */
  function confirmChanges(name, changes) {
    return new Promise((resolve) => {
      const back = document.createElement('div')
      back.className = 'ffx-confirm-back'
      const box = document.createElement('div')
      box.className = 'ffx-confirm'
      box.setAttribute('role', 'dialog')
      box.setAttribute('aria-modal', 'true')
      box.setAttribute('aria-labelledby', 'ffx-confirm-title')
      let group = ''
      const rows = changes.map((c) => {
        const head = c.group !== group ? `<tr class="ffx-confirm-group"><th colspan="3">${esc((group = c.group))}</th></tr>` : ''
        return `${head}<tr><td>${esc(c.label)}</td><td class="ffx-was">${c.from ? esc(c.from) : '<span class="ffx-none">none</span>'}</td><td class="ffx-now">${c.to ? esc(c.to) : '<span class="ffx-none">none</span>'}</td></tr>`
      }).join('')
      box.innerHTML = `
        <h3 id="ffx-confirm-title">Update "${esc(name)}"?</h3>
        <p>${changes.length} change${changes.length === 1 ? '' : 's'} will be saved over this preset. The report filters are as of the last Run forecast.</p>
        <div class="ffx-confirm-scroll"><table>
          <thead><tr><th>Setting</th><th>In the preset now</th><th>After the update</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="ffx-confirm-foot">
          <button type="button" class="ffx-btn" data-confirm="no">Cancel</button>
          <button type="button" class="ffx-btn ffx-btn-primary" data-confirm="yes">Update preset</button>
        </div>`
      const done = (ok) => {
        document.removeEventListener('keydown', onKey, true)
        back.remove()
        box.remove()
        foot()?.querySelector('[data-act=update]')?.focus()
        resolve(ok)
      }
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); done(false) }
        if (e.key === 'Tab') {
          // Keep Tab between the two buttons while the dialog is open.
          const [no, yes] = box.querySelectorAll('[data-confirm]')
          if (e.shiftKey && document.activeElement === no) { e.preventDefault(); yes.focus() }
          else if (!e.shiftKey && document.activeElement === yes) { e.preventDefault(); no.focus() }
        }
      }
      back.addEventListener('click', () => done(false))
      box.addEventListener('click', (e) => {
        const answer = e.target.closest('[data-confirm]')?.dataset.confirm
        if (answer) done(answer === 'yes')
      })
      document.addEventListener('keydown', onKey, true)
      document.body.append(back, box)
      box.querySelector('[data-confirm=yes]').focus()
    })
  }

  /** Reloads the report with the preset in the URL, so the app fills its own fields with it. */
  async function applySaved() {
    const name = selectedName()
    let entry = savedFilters().find((f) => f.name === name)
    if (!entry) return message('Choose a preset')
    message(`Applying "${name}"…`)
    if (entry.resolveContacts?.length) entry = (await resolveContacts(entry, auth)) ?? entry
    sessionStorage.setItem(APPLY_KEY, name)
    location.replace(urlFor(entry.params))
  }

  /** After Apply has reloaded the page: the preset's name in the box and a note to check and run. */
  function finishStart() {
    if (!startedWith) return
    const select = foot()?.querySelector('[data-saved]')
    if (select) {
      select.value = startedWith.name
      renderSavedButtons()
    }
    const note = sessionStorage.getItem('farlaForecast.note')
    sessionStorage.removeItem('farlaForecast.note')
    message(`"${startedWith.name}" filled in${note ? `. ${note}` : ''}. Check the fields, then Run forecast`)
    startedWith = null
  }

  function renderStatus() {
    if (lastStats) document.querySelectorAll('[data-periods]').forEach((s) => { s.textContent = lastStats.periods })
    const el = foot()?.querySelector('[data-stats]')
    if (!el) return
    el.textContent = ''
    if (lastStats) {
      const { total, shown, hidden } = lastStats
      const parts = [
        hidden.partial && `${hidden.partial} under 1 unit`,
        hidden.months && `${hidden.months} on months sold`,
        hidden.days && `${hidden.days} on days since sale`,
      ].filter(Boolean)
      el.textContent = `Farla filters kept ${shown} of ${total} SKUs` + (parts.length ? ` (hid ${parts.join(', ')})` : '') + '.'
    }
  }

  // ---- columns -----------------------------------------------------------
  //
  // The table is rows of divs, one child per column in the same order in the
  // header and in every SKU row (supplier rows are laid out differently and
  // are left alone), so a column is hidden with an nth-child rule. Columns are
  // remembered by their header text. The rows have a fixed width; it is cut
  // by the hidden columns so the table doesn't keep the empty space.

  const COLUMNS_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>'
  let tableColumns = []
  let columnsSignature = ''

  const tableHeader = () => document.querySelector('.h-\\[58px\\].sticky')

  /** Period headers hold the name, date and total; the name is the bold part. */
  function columnLabel(cell) {
    const name = cell.tagName === 'BUTTON' && cell.querySelector('.font-bold')
    return (name || cell).textContent.trim()
  }

  let tableTotal = 0

  function syncTable() {
    const header = tableHeader()
    const box = header?.parentElement
    const scroller = box?.parentElement
    if (!scroller) return
    if (!scroller.hasAttribute('data-ffx-table')) scroller.setAttribute('data-ffx-table', '')
    mountResizeHandles(header)
    // The first two are the tick box and the SKU.
    const columns = [...header.children].slice(2).map((cell, i) => ({
      index: i + 3,
      label: columnLabel(cell),
      width: parseInt(cell.style.width, 10) || 0,
      period: cell.tagName === 'BUTTON',
    }))
    const total = parseInt(box.style.width, 10) || 0
    const signature = JSON.stringify([total, columns.map((c) => c.label + c.width), [...hiddenColumns], columnWidths])
    if (signature === columnsSignature) return
    columnsSignature = signature
    tableColumns = columns
    tableTotal = total
    writeColumnCss()
    renderColumnsMenu()
  }

  const HEADER_SEL = '[data-ffx-table] .h-\\[58px\\]'
  const ROW_SEL = '[data-ffx-table] .items-stretch'
  const cellSel = (i) => `${HEADER_SEL} > :nth-child(${i}), ${ROW_SEL} > :nth-child(${i})`

  /** Hidden columns go; resized ones get their width (a period cell's width is on the button inside); the rows shrink or grow to match. */
  function writeColumnCss() {
    let style = document.getElementById('ffx-cols-style')
    if (!style) {
      style = document.createElement('style')
      style.id = 'ffx-cols-style'
      document.head.append(style)
    }
    const rules = []
    let width = tableTotal
    for (const c of tableColumns) {
      if (hiddenColumns.has(c.label)) {
        rules.push(`${cellSel(c.index)} { display: none !important; }`)
        width -= c.width
        continue
      }
      const w = columnWidths[c.label]
      if (w == null) continue
      rules.push(`${cellSel(c.index)}, ${ROW_SEL} > :nth-child(${c.index}) > button { width: ${w}px !important; }`)
      width += w - c.width
    }
    const sku = columnWidths.SKU
    if (sku != null) {
      rules.push(`${cellSel(2)} { flex: 0 0 ${sku}px !important; min-width: ${sku}px !important; }`)
      width += sku - SKU_WIDTH
    }
    if (width !== tableTotal) {
      rules.push(`
      [data-ffx-table] > div { width: ${width}px !important; }
      [data-ffx-table] [style*="min-width: ${tableTotal}px"] { min-width: ${width}px !important; }
      [data-ffx-table] .justify-end.gap-6.pr-3 { width: auto !important; flex: 1 1 auto; }`)
    }
    style.textContent = rules.join('\n')
  }

  function setHiddenColumns(labels) {
    hiddenColumns = new Set(labels)
    store(COLUMNS_KEY, [...hiddenColumns])
    columnsSignature = ''
    syncTable()
  }

  function setColumnWidths(widths) {
    columnWidths = { ...widths }
    store(WIDTHS_KEY, columnWidths)
    columnsSignature = ''
    syncTable()
  }

  // ---- drag to resize ------------------------------------------------------
  //
  // A thin handle on the right edge of each header cell. Its events are
  // stopped where they start so the app never sees them: a period header is a
  // button that strips the period, and a metric header sorts.

  function mountResizeHandles(header) {
    const cells = [...header.children].slice(1)
    if (header.querySelectorAll(':scope > * > .ffx-resize').length === cells.length) return
    for (const cell of cells) {
      if (cell.querySelector(':scope > .ffx-resize')) continue
      const handle = document.createElement('span')
      handle.className = 'ffx-resize'
      handle.tabIndex = 0
      handle.setAttribute('role', 'separator')
      handle.setAttribute('aria-orientation', 'vertical')
      handle.setAttribute('aria-label', `Resize ${columnLabel(cell)} column`)
      handle.title = 'Drag to resize, double-click to reset'
      handle.addEventListener('pointerdown', startResize)
      handle.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        const { [columnLabel(cell)]: _, ...rest } = columnWidths
        setColumnWidths(rest)
      })
      handle.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        e.stopPropagation()
        const now = cell.getBoundingClientRect().width
        setColumnWidths({ ...columnWidths, [columnLabel(cell)]: Math.max(MIN_WIDTH, Math.round(now + (e.key === 'ArrowRight' ? 10 : -10))) })
      })
      for (const type of ['click', 'mousedown', 'mouseup']) handle.addEventListener(type, (e) => e.stopPropagation())
      cell.append(handle)
    }
  }

  function startResize(e) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    const cell = handle.parentElement
    const label = columnLabel(cell)
    const startX = e.clientX
    const startWidth = cell.getBoundingClientRect().width
    handle.setPointerCapture(e.pointerId)
    document.documentElement.classList.add('ffx-resizing')
    let frame = 0
    const move = (ev) => {
      columnWidths = { ...columnWidths, [label]: Math.max(MIN_WIDTH, Math.round(startWidth + ev.clientX - startX)) }
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; writeColumnCss() })
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      document.documentElement.classList.remove('ffx-resizing')
      // The click that ends a drag must not reach the header underneath.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault() }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 300)
      setColumnWidths(columnWidths)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end, { once: true })
    handle.addEventListener('pointercancel', end, { once: true })
  }

  /** Beside CSV, in the same style, so it reads as one of the table's tools. */
  function mountColumnsButton() {
    if (document.querySelector('.ffx-cols')) return
    const csv = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'CSV')
    if (!csv) return
    const wrap = document.createElement('div')
    wrap.className = 'ffx-cols'
    wrap.innerHTML = `
      <button type="button" class="${csv.className} ffx-cols-btn" aria-haspopup="true" aria-expanded="false">${COLUMNS_ICON}Columns<span class="ffx-cols-badge" hidden></span></button>
      <div class="ffx-cols-menu" hidden></div>`
    wrap.querySelector('.ffx-cols-btn').addEventListener('click', () => toggleColumnsMenu())
    const menu = wrap.querySelector('.ffx-cols-menu')
    menu.addEventListener('change', onColumnToggle)
    menu.addEventListener('click', (e) => {
      const act = e.target.closest('[data-cols]')?.dataset.cols
      if (act === 'all') setHiddenColumns([])
      if (act === 'reset') {
        setColumnWidths(defaultWidths())
        setHiddenColumns(defaultHidden())
      }
      if (act === 'widths') setColumnWidths({})
      if (act === 'save-default') {
        store(COLUMNS_DEFAULT_KEY, [...hiddenColumns])
        store(WIDTHS_DEFAULT_KEY, columnWidths)
        renderColumnsMenu()
        const done = menu.querySelector('[data-cols-msg]')
        if (done) done.textContent = 'Saved as your default'
      }
    })
    csv.before(wrap)
    renderColumnsMenu()
  }

  function renderColumnsMenu() {
    const wrap = document.querySelector('.ffx-cols')
    if (!wrap) return
    const count = tableColumns.filter((c) => hiddenColumns.has(c.label)).length
    const badge = wrap.querySelector('.ffx-cols-badge')
    badge.hidden = !count
    badge.textContent = count ? `${count} hidden` : ''

    const menu = wrap.querySelector('.ffx-cols-menu')
    if (menu.hidden) return
    const active = document.activeElement
    const focused = active && menu.contains(active) ? { ...active.dataset } : null
    const box = (c) =>
      `<label><input type="checkbox" class="input-checkbox-class !h-4 !w-4" data-col="${c.label}"${hiddenColumns.has(c.label) ? '' : ' checked'}>${c.label}</label>`
    const periods = tableColumns.filter((c) => c.period)
    const metrics = tableColumns.filter((c) => !c.period)
    const shownPeriods = periods.filter((c) => !hiddenColumns.has(c.label)).length
    const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))
    const sameWidths = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
    const isDefault = same(hiddenColumns, new Set(defaultHidden())) && sameWidths(columnWidths, defaultWidths())
    const ownDefault = localStorage.getItem(COLUMNS_DEFAULT_KEY) != null || localStorage.getItem(WIDTHS_DEFAULT_KEY) != null
    const resized = Object.keys(columnWidths).length
    const defaultNames = defaultHidden().join(', ') || 'nothing'
    menu.innerHTML = `
      <h4>Show columns</h4>
      ${metrics.map(box).join('')}
      <h4>Sales periods</h4>
      <label><input type="checkbox" class="input-checkbox-class !h-4 !w-4" data-periods-all${shownPeriods === periods.length ? ' checked' : ''}>All periods</label>
      <div class="ffx-cols-grid">${periods.map(box).join('')}</div>
      <div class="ffx-cols-foot">
        <button type="button" class="ffx-btn" data-cols="all"${hiddenColumns.size ? '' : ' disabled'}>Show all</button>
        <button type="button" class="ffx-btn" data-cols="reset"${isDefault ? ' disabled' : ''} title="Back to ${ownDefault ? 'your' : 'the'} default: ${defaultHidden().length ? `hide ${defaultNames}` : 'every column'}${Object.keys(defaultWidths()).length ? ', with its widths' : ''}">Reset</button>
        <button type="button" class="ffx-btn" data-cols="save-default"${isDefault ? ' disabled' : ''} title="Make these columns and widths the ones Reset goes back to">Save as default</button>
      </div>
      <p class="ffx-cols-tip">Drag a header's right edge to resize; double-click it to reset.${resized ? ` <button type="button" class="ffx-link" data-cols="widths">Reset all widths</button>` : ''}</p>
      <p class="ffx-cols-msg" data-cols-msg>${isDefault ? (ownDefault ? 'These are your default columns' : 'These are the standard columns: all of them') : ''}</p>`
    const all = menu.querySelector('[data-periods-all]')
    all.indeterminate = shownPeriods > 0 && shownPeriods < periods.length
    // Rebuilding the list loses focus; put it back on the same control.
    if (focused) {
      const again = focused.col != null ? menu.querySelector(`[data-col="${window.CSS.escape(focused.col)}"]`)
        : 'periodsAll' in focused ? all
        : focused.cols ? menu.querySelector(`[data-cols="${focused.cols}"]`) : null
      again?.focus()
    }
  }

  function onColumnToggle(e) {
    const input = e.target
    const hidden = new Set(hiddenColumns)
    const set = (label, show) => (show ? hidden.delete(label) : hidden.add(label))
    if (input.dataset.col != null) set(input.dataset.col, input.checked)
    else if ('periodsAll' in input.dataset) tableColumns.filter((c) => c.period).forEach((c) => set(c.label, input.checked))
    setHiddenColumns([...hidden])
  }

  function toggleColumnsMenu(open) {
    const wrap = document.querySelector('.ffx-cols')
    if (!wrap) return
    const menu = wrap.querySelector('.ffx-cols-menu')
    const button = wrap.querySelector('.ffx-cols-btn')
    open = open ?? menu.hidden
    menu.hidden = !open
    button.setAttribute('aria-expanded', String(open))
    if (open) {
      renderColumnsMenu()
      menu.querySelector('input')?.focus()
    }
  }

  // ---- product details as a modal ----------------------------------------
  //
  // The app opens a SKU's details as a 420px panel beside the table, which
  // squeezes the table. When that comes from clicking a product's row, the
  // panel is marked and the CSS above lifts it into a centred dialog over the
  // table, with a backdrop and the ways to close it. Opened from a sales cell
  // (M12…M1) it stays beside the table as before.

  const productPanel = () => document.querySelector('aside.w-\\[420px\\]')
  const closeProduct = () => productPanel()?.querySelector('button[aria-label="Close"]')?.click()
  /** When a product was last clicked; the panel that opens just after it becomes the dialog. */
  let productClickedAt = 0

  function syncModal() {
    const aside = productPanel()
    if (aside && !aside.hasAttribute('data-ffx-modal') && Date.now() - productClickedAt < 1500) {
      productClickedAt = 0
      aside.setAttribute('data-ffx-modal', '')
      aside.setAttribute('role', 'dialog')
      aside.setAttribute('aria-modal', 'true')
      aside.querySelector('button[aria-label="Close"]')?.focus()
    }
    const modal = !!aside?.hasAttribute('data-ffx-modal')
    const backdrop = document.querySelector('.ffx-backdrop')
    if (modal && !backdrop) {
      const el = document.createElement('div')
      el.className = 'ffx-backdrop'
      el.addEventListener('click', closeProduct)
      document.body.append(el)
    } else if (!modal && backdrop) {
      backdrop.remove()
    }
  }

  function onKeydown(e) {
    if (e.key !== 'Escape') return
    const menu = document.querySelector('.ffx-cols-menu')
    if (menu && !menu.hidden) {
      toggleColumnsMenu(false)
      document.querySelector('.ffx-cols-btn')?.focus()
      return
    }
    // A popup open inside the details (customers, orders) closes first.
    if (document.querySelector('[data-radix-popper-content-wrapper], [role="dialog"]:not(aside)')) return
    if (productPanel()?.hasAttribute('data-ffx-modal')) closeProduct()
  }

  function onDocumentClick(e) {
    // Seen before the app's own handler, so the panel it opens can be told apart.
    // Anywhere on a product's row counts, except its sales cells (the M12…M1
    // cells, each wrapped in a span) and the tick box and order quantity.
    const row = e.target.closest?.('[data-ffx-table] .items-stretch')
    if (row && !e.target.closest('span.contents, input')) {
      productClickedAt = Date.now()
      if (productPanel()) requestAnimationFrame(syncModal)
    }
    const menu = document.querySelector('.ffx-cols-menu')
    if (menu && !menu.hidden && !e.target.closest('.ffx-cols')) toggleColumnsMenu(false)
  }

  /** The app can redraw its panel at any time, so put anything missing back. */
  function mount() {
    if (!document.getElementById('ffx-style')) {
      const style = document.createElement('style')
      style.id = 'ffx-style'
      style.textContent = CSS
      document.head.append(style)
    }

    const grid = document.getElementById('excludeDaysOutOfStock')?.closest('.grid')
    if (grid && !grid.querySelector('[data-ffx-cell]')) {
      grid.insertAdjacentHTML('beforeend', CELLS)
      wireInputs(grid)
      fillInputs()
    }

    const runBar = runButton()?.parentElement
    if (runBar && !runBar.querySelector('.ffx-foot')) {
      const el = document.createElement('div')
      el.className = 'ffx-foot'
      el.innerHTML = FOOT
      el.querySelector('[data-act=save]').addEventListener('click', saveCurrent)
      el.querySelector('[data-act=apply]').addEventListener('click', applySaved)
      el.querySelector('[data-act=update]').addEventListener('click', updateSaved)
      el.querySelector('[data-saved]').addEventListener('change', () => { renderSavedButtons(); message('') })
      runBar.prepend(el)
      renderSaved()
      renderStatus()
      finishStart()
    }
    syncTable()
    mountColumnsButton()
    syncModal()
  }

  function start() {
    mount()
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('click', onDocumentClick, true)
    let queued = false
    // Every check in mount() writes only when something is missing or changed,
    // so its own writes don't keep this going.
    new MutationObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        mount()
      })
    }).observe(document.body, { childList: true, subtree: true })
  }

  startFromPreset()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
