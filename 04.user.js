// ==UserScript==
// @name         Farla 04 - TradePeg Repricer Tab
// @namespace    farla-office-scripts
// @version      3.1.0
// @description  Adds a "Repricer" tab to TradePeg product pages showing each UOM's competitor SKUs and prices from Farla Tools, editable in place.
// @match        https://farla2.tradepeg.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @connect      farla-tool-api-production.up.railway.app
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/04.user.js
// @downloadURL  https://raw.githubusercontent.com/yitzi-farla/fm_scripts/main/04.user.js
// ==/UserScript==

// Published as 04.user.js in yitzi-farla/fm_scripts, from which every office PC
// updates itself. Edit here, raise @version, and copy it across.

/*
 * Signs in to Farla Tools through TradePeg itself, so there is nothing to log
 * in to and nothing secret in this script. Farla Tools hands out a one-time
 * code; the script posts it as a comment in TradePeg, as whoever is signed in;
 * Farla Tools reads the comment back, takes the author from TradePeg's own
 * record, deletes the comment and returns a session for the working day.
 * Only someone signed in to our TradePeg can post the comment.
 *
 * Requests go through GM_xmlhttpRequest because the API's CORS only admits
 * tool.farla.pro. Nothing is requested until the tab is clicked.
 *
 * TradePeg opens most pages by fetching them and swapping the content in, with
 * no page load for Tampermonkey to see, so the script runs on every TradePeg
 * page and adds the tab whenever a product's tab strip turns up without it.
 */
;(function () {
  'use strict'

  const API_URL = 'https://farla-tool-api-production.up.railway.app'
  const TOOL_URL = 'https://tool.farla.pro'
  const PRICING_BASE = '/api/v1/workflows/pricing'
  const SESSION_KEY = 'farlaSession'
  /** The margin that shows fully green; anything at or below nothing is red. */
  const MARGIN_GREEN = 0.4
  const TOKEN_PATTERN = /[?&]token=(eyJ[\w-]+\.[\w-]+\.[\w-]+)/

  // Says which copy is running, since an old one lingers in any tab opened before an update.
  // Guarded: a userscript manager without GM_info must not stop the tab.
  const VERSION = typeof GM_info === 'undefined' ? '?' : GM_info.script?.version
  const log = (...args) => console.info('[Farla Repricer]', VERSION, ...args)
  log('running on', location.pathname)

  /**
   * Who is signed in to TradePeg in this browser, read from the session token
   * the page hands its iframes. Not trusted by anyone: it only tells the script
   * when somebody else has signed in and a new Farla session is needed.
   */
  function tradepegUserId() {
    const token = document.documentElement.innerHTML.match(TOKEN_PATTERN)?.[1]
    try {
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      return String(JSON.parse(atob(payload)).sub ?? '')
    } catch {
      return ''
    }
  }

  /** TradePeg's own pages, in this page's language: /wapp/en-gb/… */
  const wapp = (path) => `/wapp/${location.pathname.split('/')[2] || 'en-gb'}${path}`

  /** Ask TradePeg, as the signed-in user, the way its own pages do. */
  async function tradepegPage(path, init = {}) {
    const response = await fetch(wapp(path), {
      credentials: 'same-origin',
      ...init,
      headers: { 'X-Requested-With': 'XMLHttpRequest', ...init.headers },
    })
    if (!response.ok) throw new FarlaError(0, `TradePeg answered ${response.status}`)
    return response
  }

  GM_addStyle(`
    #tab_repricer .frp-table { width: 100%; }
    #tab_repricer .frp-table td { vertical-align: top; }
    #tab_repricer .frp-cell { min-width: 180px; }
    #tab_repricer .frp-sku { font-family: Menlo, Consolas, monospace; font-size: 12px; }
    #tab_repricer .frp-meta { display: flex; align-items: center; gap: 14px; font-size: 12px; margin-top: 4px; min-height: 17px; white-space: nowrap; }
    #tab_repricer .frp-margin { color: #fff; font-size: 11px; font-weight: 600; padding: 2px 6px; }
    #tab_repricer .frp-uom-sku { font-family: Menlo, Consolas, monospace; font-size: 11px; color: #777; }
    #tab_repricer .frp-state { padding: 30px 15px; text-align: center; color: #777; }
    #tab_repricer .frp-state .btn { margin-top: 10px; }
  `)

  class FarlaError extends Error {
    constructor(status, message) {
      super(message)
      this.status = status
    }
  }

  /** One call to Farla Tools, with this browser's session when there is one. */
  function request(method, path, body, session) {
    return new Promise((resolve, reject) => {
      const headers = {}
      if (session) headers['X-Farla-Session'] = session
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      GM_xmlhttpRequest({
        method,
        url: `${API_URL}${path}`,
        headers,
        data: body === undefined ? undefined : JSON.stringify(body),
        anonymous: true,
        timeout: 30000,
        onload(response) {
          let parsed = null
          try {
            parsed = JSON.parse(response.responseText)
          } catch {
            // Handled below: a proxy or a stopped service answers with HTML.
          }
          if (response.status < 200 || response.status >= 300 || !parsed?.success) {
            reject(
              new FarlaError(
                response.status,
                parsed?.error?.message ??
                  parsed?.message ??
                  `Farla Tools returned ${response.status}`
              )
            )
            return
          }
          resolve(parsed.data)
        },
        onerror() {
          reject(new FarlaError(0, `Could not reach Farla Tools at ${API_URL}`))
        },
        ontimeout() {
          reject(new FarlaError(0, 'Farla Tools took too long to answer'))
        },
      })
    })
  }

  /* -------------------------------------------------------------- sign-in */

  let signingIn = null

  /** This browser's Farla session, signing in through TradePeg if there is none. */
  function session() {
    const stored = GM_getValue(SESSION_KEY, null)
    const fresh =
      stored?.token &&
      stored.tradepegUser === tradepegUserId() &&
      new Date(stored.expiresAt).getTime() - 5 * 60_000 > Date.now()
    if (fresh) return Promise.resolve(stored.token)
    // Loading a product asks for two things at once; sign in for both once.
    signingIn ??= signIn().finally(() => {
      signingIn = null
    })
    return signingIn
  }

  async function signIn() {
    log('signing in through TradePeg')
    const tradepegUser = tradepegUserId()
    const { challengeId, contactId, note } = await request(
      'POST',
      '/api/tradepeg-session/challenge',
      {}
    )
    await tradepegPage('/io/post/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ concept: 'doc-note', baseType: 'CONTACTS', baseId: contactId, note }),
    })
    const signedIn = await request('POST', '/api/tradepeg-session/verify', { challengeId })
    // Farla Tools deletes it too; as its author, so can we.
    if (signedIn.noteId) {
      void tradepegPage(`/io/post/legacy/?concept=delete-note&noteId=${signedIn.noteId}`).catch(
        () => {}
      )
    }
    GM_setValue(SESSION_KEY, {
      token: signedIn.token,
      expiresAt: signedIn.expiresAt,
      tradepegUser,
    })
    log('signed in as', signedIn.name)
    return signedIn.token
  }

  /** A call that needs a session: signs in first if need be, and once more if it lapsed. */
  async function call(method, path, body) {
    try {
      return await request(method, path, body, await session())
    } catch (error) {
      if (error.status !== 401 || !GM_getValue(SESSION_KEY, null)) throw error
      GM_deleteValue(SESSION_KEY)
      return request(method, path, body, await session())
    }
  }

  /* ---------------------------------------------------------- formatting */

  const asNumber = (value) => {
    if (value === null || value === undefined || value === '') return null
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  const money = (value) => {
    const parsed = asNumber(value)
    return parsed === null
      ? '—'
      : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(parsed)
  }

  const ago = (value) => {
    if (!value) return 'never'
    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.round(minutes / 60)
    if (hours < 48) return `${hours}h ago`
    return `${Math.round(hours / 24)}d ago`
  }

  /** Same threshold as the Farla Tools sheet: older than a refresh cycle and a bit. */
  const isStale = (value) =>
    !value || Date.now() - new Date(value).getTime() > 7 * 60 * 60 * 1000

  /** Build DOM without innerHTML: titles and SKUs come from a database. */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs ?? {})) {
      if (value === null || value === undefined || value === false) continue
      if (key === 'class') node.className = value
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
      else node.setAttribute(key, value === true ? '' : value)
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue
      node.append(child instanceof Node ? child : document.createTextNode(String(child)))
    }
    return node
  }

  const icon = (name) => el('i', { class: `fa ${name}` })

  /* ------------------------------------------------------------- the tab */

  const state = {
    reference: '',
    competitors: [],
    rows: [],
    loading: false,
    /** Bumped per product opened, so a load for the last one is thrown away. */
    generation: 0,
    /** `${uomSku}:${competitorId}` -> refresh this cell's line under the input. */
    cells: new Map(),
  }

  let pane = null
  let body = null
  let summary = null

  function productReference() {
    // The read-only "SKU" field on the Details tab.
    for (const help of document.querySelectorAll('#tab_details .help-block')) {
      if (help.textContent.trim() !== 'SKU') continue
      const value = help.parentElement?.querySelector('.form-control')?.textContent.trim()
      if (value) return value
    }
    return document.title.trim()
  }

  function install() {
    const tabs = document.getElementById('part-tabs')
    const content = tabs?.parentElement?.querySelector(':scope > .tab-content')
    if (!tabs || !content || tabs.querySelector('a[aria-controls="tab_repricer"]')) return
    // Left behind by the product before, if TradePeg kept it.
    document.getElementById('tab_repricer')?.remove()
    state.generation++
    state.loading = false
    state.cells.clear()

    const anchor = el(
      'a',
      { href: '#tab_repricer', 'aria-controls': 'tab_repricer', role: 'tab', 'data-toggle': 'tab' },
      'Repricer'
    )
    const item = el('li', { role: 'presentation' }, anchor)
    const pricelists = tabs.querySelector('a[aria-controls="tab_pricing"]')?.closest('li')
    if (pricelists) pricelists.after(item)
    else tabs.append(item)

    summary = el('span', { class: 'label label-info label-normal ml10' })
    summary.style.display = 'none'
    body = el('div', { class: 'panel-body p0' })
    pane = el(
      'div',
      { id: 'tab_repricer', role: 'tabpanel', class: 'tab-pane' },
      el(
        'div',
        { class: 'divholder' },
        el(
          'div',
          { class: 'panel panel-parts' },
          el(
            'div',
            { class: 'panel-heading' },
            'Repricer',
            summary,
            el(
              'div',
              { class: 'pull-right btns' },
              el(
                'div',
                { class: 'btn-group' },
                el(
                  'a',
                  {
                    class: 'btn btn-info btn-sm',
                    href: `${TOOL_URL}/workflows/pricing/competitor-skus`,
                    target: '_blank',
                    rel: 'noreferrer',
                  },
                  'Open Farla Tools'
                ),
                el(
                  'a',
                  {
                    class: 'btn btn-success btn-sm',
                    href: '#',
                    onclick: (event) => {
                      event.preventDefault()
                      void load()
                    },
                  },
                  icon('fa-refresh'),
                  ' Refresh'
                )
              )
            )
          ),
          body
        )
      )
    )
    content.append(pane)

    log('tab added for', productReference())

    anchor.addEventListener('click', () => {
      const wasOpen = pane.classList.contains('active')
      // Bootstrap's own tab handler shows the pane; do it by hand if it is absent.
      setTimeout(() => {
        if (!pane.classList.contains('active')) activate(tabs, item, content)
      }, 0)
      if (!wasOpen) void load()
    })
  }

  function activate(tabs, item, content) {
    for (const li of tabs.querySelectorAll(':scope > li')) li.classList.remove('active')
    for (const other of content.querySelectorAll(':scope > .tab-pane')) {
      other.classList.remove('active', 'in')
    }
    item.classList.add('active')
    pane.classList.add('active', 'in')
  }

  function showState(...children) {
    summary.style.display = 'none'
    body.replaceChildren(el('div', { class: 'frp-state' }, ...children))
  }

  async function load() {
    if (state.loading) return
    state.loading = true
    const generation = state.generation
    state.reference = productReference()
    showState(icon('fa-spinner fa-spin'), ' Loading from Farla Tools…')
    try {
      const [competitors, rows] = await Promise.all([
        call('GET', `${PRICING_BASE}/competitors`),
        fetchRows(),
      ])
      if (generation !== state.generation) return
      state.competitors = competitors.filter((competitor) => competitor.enabled)
      state.rows = rows
      render()
    } catch (error) {
      if (generation === state.generation) showError(error)
    } finally {
      if (generation === state.generation) state.loading = false
    }
  }

  async function fetchRows() {
    const reference = state.reference
    const page = await call(
      'GET',
      `${PRICING_BASE}/mappings?q=${encodeURIComponent(reference)}&filter=all&page=1&limit=200`
    )
    // The search is a substring match on SKU, title and brand; keep this product only.
    const wanted = reference.toUpperCase()
    const exact = page.items.filter((row) => String(row.parent_reference).toUpperCase() === wanted)
    return exact.length
      ? exact
      : page.items.filter((row) => String(row.uom_sku).toUpperCase().startsWith(`${wanted}-`))
  }

  function showError(error) {
    showState(
      el('div', { class: 'alert alert-danger', style: 'margin:0 0 10px' }, error.message),
      el(
        'a',
        {
          class: 'btn btn-info btn-sm',
          href: '#',
          onclick: (event) => {
            event.preventDefault()
            void load()
          },
        },
        icon('fa-refresh'),
        ' Try again'
      )
    )
  }

  function render() {
    state.cells.clear()
    const { rows, competitors, reference } = state

    if (!rows.length) {
      showState(
        el('p', null, `Farla Tools is not pricing ${reference}.`),
        el(
          'p',
          { class: 'small' },
          'Only active products in the repricing range are on the competitor SKU sheet.'
        )
      )
      return
    }

    const mapped = rows.filter((row) =>
      Object.values(row.mappings ?? {}).some((cell) => cell.competitorSku)
    ).length
    summary.textContent = `${rows.length} UOM${rows.length === 1 ? '' : 's'} · ${mapped} mapped`
    summary.style.display = ''

    const table = el(
      'table',
      { class: 'table-grid table-bordered frp-table' },
      el(
        'thead',
        null,
        el(
          'tr',
          null,
          el('th', null, 'UOM'),
          competitors.map((competitor) => el('th', null, competitor.name))
        )
      ),
      el(
        'tbody',
        null,
        rows.map((row) =>
          el(
            'tr',
            null,
            el(
              'td',
              null,
              el('span', { class: 'bold' }, row.uom_name),
              ' ',
              el(
                'span',
                { class: 'small text-muted' },
                `${row.shelf_quantity} unit${Number(row.shelf_quantity) === 1 ? '' : 's'}`
              ),
              el('div', { class: 'frp-uom-sku' }, row.uom_sku)
            ),
            competitors.map((competitor) => el('td', null, mappingCell(row, competitor)))
          )
        )
      )
    )
    body.replaceChildren(table)
  }

  /**
   * One competitor's SKU for one UOM, saved on blur like the Farla Tools sheet:
   * an empty SKU removes the mapping.
   */
  function mappingCell(row, competitor) {
    const key = `${row.uom_sku}:${competitor.id}`
    let committed = row.mappings?.[competitor.id]?.competitorSku ?? ''
    const meta = el('div', { class: 'frp-meta' })
    const input = el('input', {
      type: 'text',
      class: 'form-control input-sm frp-sku',
      placeholder: 'Competitor SKU',
      'aria-label': `${competitor.name} SKU for ${row.uom_sku}`,
      autocomplete: 'off',
      spellcheck: 'false',
    })
    input.value = committed

    const paint = (cell, cost) => {
      meta.replaceChildren(...cellMeta(cell, competitor, cost))
      const next = cell?.competitorSku ?? ''
      // The API normalises what was typed; show that, unless somebody is typing.
      if (next !== committed && document.activeElement !== input) {
        committed = next
        input.value = next
      }
    }
    paint(row.mappings?.[competitor.id], row.cost)
    state.cells.set(key, paint)

    const save = async () => {
      const next = input.value.trim()
      if (next === committed) return
      const previous = committed
      committed = next
      input.disabled = true
      meta.replaceChildren(el('span', { class: 'text-muted' }, icon('fa-spinner fa-spin'), ' Saving…'))
      try {
        await call('PUT', `${PRICING_BASE}/mappings`, {
          uomSku: row.uom_sku,
          competitorId: competitor.id,
          competitorSku: next,
          note: '',
          enabled: true,
        })
        input.disabled = false
        await refreshCells()
      } catch (error) {
        committed = previous
        input.disabled = false
        meta.replaceChildren(el('span', { class: 'text-danger' }, error.message))
        if (error.status === 401) showError(error)
      }
    }

    input.addEventListener('blur', () => void save())
    input.addEventListener('keydown', (event) => {
      // Keep TradePeg's keyboard shortcuts out of the way while typing.
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        input.blur()
      }
      if (event.key === 'Escape') {
        input.value = committed
        input.blur()
      }
    })

    return el('div', { class: 'frp-cell' }, input, meta)
  }

  /** Reread the product after a save and repaint each cell, leaving the table standing. */
  async function refreshCells() {
    const rows = await fetchRows()
    state.rows = rows
    for (const row of rows) {
      for (const competitor of state.competitors) {
        state.cells.get(`${row.uom_sku}:${competitor.id}`)?.(row.mappings?.[competitor.id], row.cost)
      }
    }
  }

  /**
   * What we would make selling at this price, on our cheapest buy price: red at
   * nothing or less, through amber, to green at MARGIN_GREEN and above.
   */
  function marginTag(price, cost) {
    const sell = asNumber(price)
    const buy = asNumber(cost)
    if (sell === null || buy === null || sell <= 0) return null
    const margin = (sell - buy) / sell
    const hue = Math.round(120 * Math.min(1, Math.max(0, margin / MARGIN_GREEN)))
    const tag = el(
      'span',
      {
        class: 'label frp-margin',
        title: `Margin at ${money(sell)} on our cheapest buy price of ${money(buy)}`,
      },
      `${(margin * 100).toFixed(0)}%`
    )
    tag.style.background = `hsl(${hue}, 65%, 38%)`
    return tag
  }

  function cellMeta(cell, competitor, cost) {
    if (!cell?.competitorSku) return []
    if (cell.status === 'not_found') return [el('span', { class: 'text-danger' }, 'Not found')]
    if (cell.status !== 'ok') return [el('span', { class: 'text-muted' }, 'Awaiting refresh')]
    // Filtered: replaceChildren would print a skipped `false` as the word.
    return [
      el('span', { class: 'bold' }, money(cell.priceExVat)),
      marginTag(cell.priceExVat, cost),
      el(
        'span',
        {
          class: isStale(cell.observedAt) ? 'text-warning' : 'text-muted',
          title: cell.observedAt ? new Date(cell.observedAt).toLocaleString('en-GB') : null,
        },
        ago(cell.observedAt)
      ),
      cell.inStock === false && el('span', { class: 'label label-warning' }, 'Out of stock'),
      cell.url &&
        el(
          'a',
          { href: cell.url, target: '_blank', rel: 'noreferrer', title: `View on ${competitor.name}` },
          icon('fa-external-link')
        ),
    ].filter(Boolean)
  }

  // Keep watching for as long as the page is open: every product opened in
  // place brings a fresh tab strip. Checks are batched to one per frame.
  const tryInstall = () => {
    try {
      install()
    } catch (error) {
      // Keep watching: one odd page must not cost the tab on the next.
      console.error('[Farla Repricer]', VERSION, 'could not add the tab', error)
    }
  }
  tryInstall()
  let queued = false
  new MutationObserver(() => {
    if (queued) return
    queued = true
    // Not requestAnimationFrame: it never fires in a background browser tab.
    setTimeout(() => {
      queued = false
      tryInstall()
    }, 50)
  }).observe(document.body, { childList: true, subtree: true })
})()
