// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail view with the model's own inputs and the protocol's farm
// plan, the live-token peers that anchor the model, and the model itself.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var growthFactor = 1 + growth / 200;
    var age = row.age_days === null ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (model.maturity_range * Math.min(age, model.maturity_days)) / model.maturity_days;
    var breadth = 1 + model.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), model.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthFactor * maturity * breadth));
  }

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(3) + 'x'; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = (location.hash || '').replace(/^#/, '');
    var out = {};
    hash.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }
  function writeHash() {
    var parts = [];
    if (state.tab !== 'board') parts.push('tab=' + state.tab);
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.category !== 'all') parts.push('cat=' + encodeURIComponent(state.category));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.wl) parts.push('wl=1');
    if (state.selected) parts.push('detail=' + state.selected);
    var next = parts.length ? '#' + parts.join('&') : '';
    if (location.hash !== next) history.replaceState(null, '', next || location.pathname + location.search);
  }
  function applyHash() {
    var h = readHash();
    state.tab = h.tab === 'live' || h.tab === 'model' ? h.tab : 'board';
    state.q = h.q || '';
    state.category = h.cat || 'all';
    state.chain = h.chain || 'all';
    state.wl = h.wl === '1';
    state.selected = h.detail || null;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = a.implied_value_usd; bv = b.implied_value_usd; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days; bv = b.age_days; }
      else if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else { av = a.rank; bv = b.rank; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.rank - b.rank;
    });
    return rows;
  }

  function renderHeader() {
    var m = DATA.meta;
    var header = el('header', { class: 'hero' },
      el('h1', {}, 'Token Radar', el('span', { class: 'dot', text: '.' })),
      el('p', { class: 'sub', text: 'Pre-token protocols ranked by what a launch would be worth — each value peer-anchored to live tokens, each row with a plan to farm it. Snapshot: ' + m.as_of + ' (DefiLlama, ' + m.protocols + ' protocols).' })
    );
    var stats = el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('b', { text: String(m.board_rows) }), el('span', { text: 'protocols ranked' })),
      el('div', { class: 'stat' }, el('b', { text: String(m.watchlist) }), el('span', { text: 'on the watchlist' })),
      el('div', { class: 'stat' }, el('b', { text: String(m.pre_token) }), el('span', { text: 'pre-token in snapshot' })),
      el('div', { class: 'stat' }, el('b', { text: 'radar-2' }), el('span', { text: 'model version' })),
      el('div', { class: 'stat' }, el('b', { text: fmtUsd(DATA.rows[0].implied_value_usd) }), el('span', { text: 'top implied value' }))
    );
    return [header, stats];
  }

  function renderTabs() {
    var tabs = el('nav', { class: 'tabs', role: 'tablist' });
    [['board', 'Board'], ['live', 'Live tokens & peers'], ['model', 'How the model works']].forEach(function (t) {
      tabs.appendChild(el('button', {
        role: 'tab', 'aria-selected': state.tab === t[0] ? 'true' : 'false',
        text: t[1],
        onclick: function () { state.tab = t[0]; state.selected = null; render(); }
      }));
    });
    return tabs;
  }

  function renderControls() {
    var cats = [];
    DATA.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category); });
    cats.sort();
    var chains = [];
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); }); });
    chains.sort();
    var catSel = el('select', { 'aria-label': 'Filter by category', onchange: function (e) { state.category = e.target.value; render(); } },
      el('option', { value: 'all', text: 'All categories' }));
    cats.forEach(function (c) { catSel.appendChild(el('option', { value: c, selected: state.category === c ? 'selected' : null, text: c })); });
    var chainSel = el('select', { 'aria-label': 'Filter by chain', onchange: function (e) { state.chain = e.target.value; render(); } },
      el('option', { value: 'all', text: 'All chains' }));
    chains.forEach(function (c) { chainSel.appendChild(el('option', { value: c, selected: state.chain === c ? 'selected' : null, text: c })); });
    var sortSel = el('select', { 'aria-label': 'Sort by', onchange: function (e) { state.sort = e.target.value; render(); } },
      el('option', { value: 'implied', text: 'Sort: implied value' }),
      el('option', { value: 'tvl', text: 'Sort: TVL' }),
      el('option', { value: 'growth', text: 'Sort: 7-day growth' }),
      el('option', { value: 'age', text: 'Sort: age with no token' }),
      el('option', { value: 'name', text: 'Sort: name' }));
    sortSel.value = state.sort;
    return el('div', { class: 'controls' },
      el('input', { type: 'search', placeholder: 'Search a protocol…', value: state.q, 'aria-label': 'Search protocols', oninput: function (e) { state.q = e.target.value; render(); } }),
      catSel, chainSel, sortSel,
      el('label', { class: 'chk' },
        el('input', { type: 'checkbox', checked: state.wl ? 'checked' : null, onchange: function (e) { state.wl = e.target.checked; render(); } }),
        'Watchlist only')
    );
  }

  function renderDetail(row) {
    var model = DATA.model;
    var recomputed = impliedOf(row, model);
    var match = recomputed === row.implied_value_usd ? '✓ matches board.json' : '≠ board.json says ' + fmtUsd(row.implied_value_usd);
    var growthTxt = row.change_7d === null ? 'no 7-day change reported' : fmtPct(row.change_7d);
    var math = 'TVL ' + fmtUsd(row.tvl_usd) + ' × peer ' + fmtMult(row.peer_multiple) + ' × growth ' + row.growth_factor.toFixed(3) +
      ' × maturity ' + row.maturity_factor.toFixed(3) + ' × breadth ' + row.breadth_factor.toFixed(3) + ' = ';
    var section = el('section', { class: 'detail', id: 'detail', 'aria-label': 'Protocol detail' },
      el('h2', {}, '#' + row.rank + ' ' + row.name + ' ', el('span', { class: 'rank-tag', text: row.watchlist ? '· on the watchlist' : '· below the floor' })),
      el('p', { class: 'meta', text: (row.category || 'No category') + ' · ' + row.chains.join(', ') + ' · TVL ' + fmtUsd(row.tvl_usd) + ' · ' + growthTxt + ' · running ' + fmtAge(row.age_days) + ' with no token' }),
      el('div', { class: 'math' }, math, el('b', { text: fmtUsd(row.implied_value_usd) + '  ' + match })),
      el('div', { class: 'factors' },
        el('div', { class: 'factor' }, el('b', { text: fmtMult(row.peer_multiple) }), el('span', { text: 'peer multiple (' + row.peer_source + ', ' + row.peer_n + ' peer' + (row.peer_n === 1 ? '' : 's') + ')' })),
        el('div', { class: 'factor' }, el('b', { text: fmtUsd(row.tvl_usd * row.peer_multiple) }), el('span', { text: 'base value (TVL × peer)' })),
        el('div', { class: 'factor' }, el('b', { text: row.growth_factor.toFixed(3) + '×' }), el('span', { text: 'growth factor (' + growthTxt + ')' })),
        el('div', { class: 'factor' }, el('b', { text: row.maturity_factor.toFixed(3) + '×' }), el('span', { text: 'maturity factor (' + fmtAge(row.age_days) + ' old)' })),
        el('div', { class: 'factor' }, el('b', { text: row.breadth_factor.toFixed(3) + '×' }), el('span', { text: 'breadth factor (' + row.chains.length + ' chains)' }))
      ),
      el('h3', { text: 'How to farm it' })
    );
    var list = el('ol', { class: 'farm' });
    row.farm_plan.forEach(function (s) {
      list.appendChild(el('li', {},
        el('div', { text: s.text }),
        el('div', { class: 'cost', text: 'Cost: ' + s.cost + '  ·  ' }),
        el('span', { class: 'time', text: 'Time: ' + s.time })));
    });
    section.appendChild(list);
    section.appendChild(el('p', { class: 'note', text: 'Implied value is this radar\u2019s own claim from the snapshot, not a prediction that a token launches, and never financial advice. A protocol records no token; that is not proof it has none.' }));
    return section;
  }

  function renderBoard() {
    var rows = filteredRows();
    var wrap = el('div', { id: 'board' });
    var selected = state.selected ? DATA.rows.find(function (r) { return r.slug === state.selected; }) : null;
    if (selected) wrap.appendChild(renderDetail(selected));
    wrap.appendChild(renderControls());
    wrap.appendChild(el('p', { class: 'result-line', text: 'Showing ' + rows.length + ' of ' + DATA.rows.length + ' ranked protocols. Click a row for its detail and farm plan.' }));
    if (rows.length === 0) {
      wrap.appendChild(el('div', { class: 'empty', text: 'No protocol matches these filters.' }));
      return wrap;
    }
    var table = el('table', { class: 'board' });
    var thead = el('thead');
    var headRow = el('tr');
    [['Rank', 'rank'], ['Protocol', 'name'], ['Category', null], ['Chains', null], ['TVL', 'tvl'], ['7d', 'growth'], ['Age', 'age'], ['Peer ×', null], ['Implied value', 'implied']].forEach(function (c) {
      var th = el('th', { class: c[0] === 'TVL' || c[0] === '7d' || c[0] === 'Age' || c[0] === 'Peer ×' || c[0] === 'Implied value' ? 'num' : null });
      if (c[1]) {
        var btn = el('button', { text: c[0] + (state.sort === c[1] ? (state.dir === -1 ? ' ↓' : ' ↑') : ''), onclick: function () {
          if (state.sort === c[1]) state.dir = -state.dir; else { state.sort = c[1]; state.dir = -1; }
          render();
        } });
        th.appendChild(btn);
      } else th.textContent = c[0];
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr', { class: state.selected === r.slug ? 'selected' : null, onclick: function () { state.selected = state.selected === r.slug ? null : r.slug; render(); } });
      tr.appendChild(el('td', { class: 'rank num', text: '#' + r.rank }));
      var nameCell = el('td', { class: 'name' });
      nameCell.appendChild(el('b', { text: r.name }));
      if (r.watchlist) nameCell.appendChild(el('span', { class: 'pill wl', text: 'watchlist' }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { text: r.category || '—' }));
      var chainCell = el('td');
      r.chains.slice(0, 2).forEach(function (c) { chainCell.appendChild(el('span', { class: 'pill', text: c })); });
      if (r.chains.length > 2) chainCell.appendChild(el('span', { class: 'pill', text: '+' + (r.chains.length - 2) }));
      tr.appendChild(chainCell);
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      var g = el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) });
      tr.appendChild(g);
      tr.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
      tr.appendChild(el('td', { class: 'num', text: fmtMult(r.peer_multiple) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function renderLive() {
    var wrap = el('div');
    wrap.appendChild(el('section', { class: 'block' },
      el('h2', { text: 'The peers that anchor the model' }),
      el('p', { text: 'Each category\u2019s peer multiple is the median market-cap-to-TVL ratio of its live-token protocols. A category with fewer than 3 live peers uses the whole snapshot\u2019s median (' + DATA.model.global_multiple.toFixed(3) + 'x), so one outlier cannot set a price.' }),
      (function () {
        var t = el('table', { class: 'mini' });
        t.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Category' }), el('th', { text: 'Live peers' }), el('th', { text: 'Median mcap / TVL' }), el('th', { text: 'Used as peer?' }))));
        var tb = el('tbody');
        DATA.peers.forEach(function (p) {
          tb.appendChild(el('tr', {},
            el('td', { text: p.category }),
            el('td', { text: String(p.n) }),
            el('td', { text: p.median === null ? 'n/a' : fmtMult(p.median) }),
            el('td', { text: p.n >= DATA.model.peer_min_n ? 'yes' : 'no — global median' })));
        });
        t.appendChild(tb);
        return t;
      })()
    ));
    var live = el('section', { class: 'block' },
      el('h2', { text: 'Live tokens, kept apart' }),
      el('p', { text: 'The 40 largest live-token protocols by market cap. They are the market\u2019s own values and never enter the ranked board — the board is only protocols whose token does not exist yet.' })
    );
    var t = el('table', { class: 'mini' });
    t.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'mcap / TVL' }))));
    var tb = el('tbody');
    DATA.live.forEach(function (p) {
      tb.appendChild(el('tr', {},
        el('td', { text: p.name }),
        el('td', { text: p.category || '—' }),
        el('td', { text: fmtUsd(p.tvl_usd) }),
        el('td', { text: fmtUsd(p.mcap_usd) }),
        el('td', { text: fmtMult(p.multiple) })));
    });
    t.appendChild(tb);
    live.appendChild(t);
    wrap.appendChild(live);
    return wrap;
  }

  function renderModel() {
    var m = DATA.model;
    var wrap = el('div');
    wrap.appendChild(el('section', { class: 'block' },
      el('h2', { text: 'How the model works (radar-2)' }),
      el('p', { text: 'Every implied value follows from the snapshot\u2019s own figures. No protocol name is special-cased; the same function scores every row.' }),
      el('pre', { text:
        'peer       = median(mcap / TVL) of live peers in the category (n >= 3),\n' +
        '             else the global median ' + m.global_multiple.toFixed(3) + 'x; clamped to [0.02, 1.5]\n' +
        'base       = TVL x peer\n' +
        'growth     = clamp(7-day TVL change, -50%, +200%); null counts as 0\n' +
        'growthMul  = 1 + growth / 200\n' +
        'age_days   = snapshot date - listed_at; null counts as 365 days\n' +
        'maturity   = 0.7 + 0.3 x min(age_days, 1460) / 1460\n' +
        'breadth    = 1 + 0.02 x min(chains - 1, 10)\n' +
        'implied    = max(1, round(base x growthMul x maturity x breadth))' }),
      el('p', { text: 'Why peers: a token is worth what the market already pays for the same kind of business. Lending protocols trade near 0.13x TVL, DEXes near 0.34x, RWA near 0.28x — the model lets each category speak for itself instead of stamping one flat multiple on all of them.' }),
      el('p', { text: 'Why age: a protocol that has run for years with no token has more pent-up launch value than one listed last month. Why growth: a protocol gaining TVL is worth more than one shrinking. Why breadth: each extra chain is another market the token would reach.' })
    ));
    wrap.appendChild(el('section', { class: 'block' },
      el('h2', { text: 'What the board covers' }),
      el('p', { text: 'The watchlist (40 protocols at or above $50M TVL with no token recorded) is the floor, never the ceiling. This board extends the watchlist\u2019s own definition below the floor: every pre-token protocol that passes the same checks — not a wrapped, staked or bridged product, no version marker in its name, no exchange prefix — whatever its TVL. That adds 158 early protocols the floor leaves out, for 198 rows in all.' }),
      el('p', { text: 'Left out on purpose: centralised exchanges, liquid-staking and bridge products, and wrapped or staked products of tokens that already trade (WBTC is Bitcoin on Ethereum, not a protocol waiting on a launch). The snapshot does not carry DefiLlama\u2019s parentProtocol field, so that one check could not be run below the floor; the name and category checks are the ones the file lets this entry run.' }),
      el('p', { text: 'A protocol is called pre-token because its snapshot entry records no token — that is not proof it has none. Implied value is this radar\u2019s own claim, never a prediction that a token launches, and never financial advice.' })
    ));
    wrap.appendChild(el('section', { class: 'block' },
      el('h2', { text: 'How to read a farm plan' }),
      el('p', { text: 'Each row carries five steps: set up on the protocol\u2019s chain, the core action for its category, a weekly cadence, checking for a points program, and watching the protocol and the risks. Every step names what it costs and how long it takes. Steps are generated from the protocol\u2019s own category, chains, TVL and age — the same derivation that writes board.json.' })
    ));
    return wrap;
  }

  function render() {
    writeHash();
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '';
    renderHeader().forEach(function (n) { app.appendChild(n); });
    app.appendChild(renderTabs());
    if (state.tab === 'live') app.appendChild(renderLive());
    else if (state.tab === 'model') app.appendChild(renderModel());
    else app.appendChild(renderBoard());
    app.appendChild(el('footer', {},
      el('p', { text: 'Source: ' + DATA.meta.source + ' · Snapshot as of ' + DATA.meta.as_of + ' · ' + DATA.meta.protocols + ' protocols, ' + DATA.meta.pre_token + ' pre-token · Model radar-2 · Implied values are this entry\u2019s claims, not predictions and not financial advice.' })));
  }

  applyHash();
  window.addEventListener('hashchange', function () { applyHash(); render(); });
  render();
})();
