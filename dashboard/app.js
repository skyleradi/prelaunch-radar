/* Prelaunch Radar — vanilla JS, no dependencies, no network.
   Reads window.RADAR (written by main.ts from the sealed snapshot). */
(function () {
  'use strict';

  var R = window.RADAR;
  var $app = document.getElementById('app');
  var $meta = document.getElementById('meta');
  var $nav = document.getElementById('nav');

  /* ---------- formatting ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function usd(n) {
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(v) { if (v === null || v === undefined) return '<span class="flat">—</span>'; var c = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat'; var s = v > 0 ? '+' : ''; return '<span class="' + c + '">' + s + v.toFixed(1) + '%</span>'; }
  function ageTxt(d) { if (d === null || d === undefined) return '<span class="flat">unknown</span>'; if (d >= 730) return (d / 365).toFixed(1) + ' yr'; if (d >= 60) return Math.round(d / 30) + ' mo'; return d + ' d'; }
  function oddsClass(o) { return o >= 0.5 ? 'hi' : o >= 0.3 ? 'mid' : 'lo'; }
  function chainTags(chains) {
    var show = chains.slice(0, 2).map(function (c) { return '<span class="chain-tag">' + esc(c) + '</span>'; }).join('');
    if (chains.length > 2) show += '<span class="chain-tag">+' + (chains.length - 2) + '</span>';
    return show || '<span class="flat">—</span>';
  }

  /* ---------- state (hash: #/view?key=val&...) ---------- */
  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/board';
    var parts = h.split('?');
    var seg = parts[0].split('/').filter(Boolean);
    var q = {};
    if (parts[1]) parts[1].split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    return { view: seg[0] || 'board', slug: seg[1] || null, q: q };
  }
  function setHash(h) { if (location.hash !== h) location.hash = h; else render(); }

  var S = parseHash();
  var st = {
    sort: S.q.sort || 'implied',
    dir: S.q.dir || 'desc',
    q: S.q.q || '',
    cats: S.q.cat ? S.q.cat.split(',').filter(Boolean) : [],
    chain: S.q.chain || '',
    min: S.q.min ? Number(S.q.min) : 0,
    wl: S.q.wl === '1'
  };

  function syncHash() {
    var p = [];
    if (st.sort !== 'implied' || st.dir !== 'desc') p.push('sort=' + encodeURIComponent(st.sort), 'dir=' + encodeURIComponent(st.dir));
    if (st.q) p.push('q=' + encodeURIComponent(st.q));
    if (st.cats.length) p.push('cat=' + encodeURIComponent(st.cats.join(',')));
    if (st.chain) p.push('chain=' + encodeURIComponent(st.chain));
    if (st.min) p.push('min=' + st.min);
    if (st.wl) p.push('wl=1');
    var h = '#/board' + (p.length ? '?' + p.join('&') : '');
    if (S.view === 'board') { if (location.hash !== h) { history.replaceState(null, '', h); } }
  }

  /* ---------- header meta ---------- */
  var maxTvl = 0;
  R.rows.forEach(function (r) { if (r.tvl_usd > maxTvl) maxTvl = r.tvl_usd; });
  $meta.innerHTML = '<div>snapshot <b>' + esc(R.as_of) + '</b> · ' + R.rows.length + ' protocols scored</div>' +
    '<div>watchlist <b>' + R.watchlist_size + '</b> covered · floor <b>' + usd(R.floor_usd) + '</b> TVL</div>';
  document.getElementById('foot-src').innerHTML = 'Data: ' + esc(R.source);
  document.getElementById('foot-model').textContent = R.model_version;
  document.getElementById('foot-asof').textContent = R.as_of;
  document.getElementById('foot-floor').textContent = usd(R.floor_usd);

  /* ---------- filters ---------- */
  var catCount = {};
  R.rows.forEach(function (r) { var c = r.category || 'Uncategorized'; catCount[c] = (catCount[c] || 0) + 1; });
  var topCats = Object.keys(catCount).sort(function (a, b) { return catCount[b] - catCount[a]; }).slice(0, 11);
  var chains = [];
  R.rows.forEach(function (r) { r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
  chains.sort();
  var MINS = [[0, 'Any TVL'], [1e7, '≥ $10M'], [2.5e7, '≥ $25M'], [5e7, '≥ $50M (floor)'], [1e8, '≥ $100M'], [5e8, '≥ $500M']];

  function toolbarHtml() {
    return '<div class="toolbar">' +
      '<span class="search"><input id="f-q" type="search" placeholder="Search protocol…" value="' + esc(st.q) + '"></span>' +
      '<select id="f-chain"><option value="">Any chain</option>' + chains.map(function (c) { return '<option' + (st.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select id="f-min">' + MINS.map(function (m) { return '<option value="' + m[0] + '"' + (st.min === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select>' +
      '<label class="toggle"><input id="f-wl" type="checkbox"' + (st.wl ? ' checked' : '') + '> watchlist only</label>' +
      '</div>' +
      '<div class="chips"><span class="chip' + (st.cats.length === 0 ? ' on' : '') + '" data-cat="">All</span>' +
      topCats.map(function (c) { return '<span class="chip' + (st.cats.indexOf(c) >= 0 ? ' on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '<span class="n">' + catCount[c] + '</span></span>'; }).join('') + '</div>';
  }

  function filtered() {
    var q = st.q.toLowerCase();
    var min = st.min || 0;
    return R.rows.filter(function (r) {
      if (st.wl && !r.on_watchlist) return false;
      if (min && r.tvl_usd < min) return false;
      if (st.chain && r.chains.indexOf(st.chain) < 0) return false;
      if (st.cats.length && st.cats.indexOf(r.category || 'Uncategorized') < 0) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
  }

  var SORTS = {
    implied: function (r) { return r.implied_value_usd; },
    tvl: function (r) { return r.tvl_usd; },
    growth: function (r) { return r.change_7d === null ? -999 : r.change_7d; },
    age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    comp: function (r) { return r.comp_multiple; },
    odds: function (r) { return r.odds; },
    name: function (r) { return r.name.toLowerCase(); },
    rank: function (r) { return r.rank; }
  };
  var SORT_LABEL = { implied: 'Implied value', tvl: 'TVL', growth: '7d', age: 'Age', comp: 'Comp ×', odds: 'Odds', name: 'Protocol', rank: 'Rank' };

  function sorted(rows) {
    var k = SORTS[st.sort] || SORTS.implied;
    var dir = st.dir === 'asc' ? 1 : -1;
    return rows.slice().sort(function (a, b) {
      var va = k(a), vb = k(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  /* ---------- board ---------- */
  function th(key, label, num) {
    var on = st.sort === key;
    var cls = (on ? 'sorted' : '') + (on && num ? ' num' : num ? ' num' : '');
    var dirMark = on ? '<span class="dir">' + (st.dir === 'asc' ? '▲' : '▼') + '</span>' : '';
    return '<th data-sort="' + key + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + label + dirMark + '</th>';
  }

  function boardHtml() {
    var rows = sorted(filtered());
    var maxImp = rows.length ? rows[0].implied_value_usd : 1;
    var minImp = R.rows.length ? R.rows[R.rows.length - 1].implied_value_usd : 1;
    var span = Math.max(1, Math.log(maxImp) - Math.log(minImp));
    var body = rows.map(function (r) {
      var w = Math.max(3, Math.round(100 * (Math.log(r.tvl_usd) - Math.log(minImp)) / span));
      var valW = Math.max(3, Math.round(100 * (Math.log(r.implied_value_usd) - Math.log(1)) / Math.log(maxImp)));
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.on_watchlist ? ' class="watch"' : '') + '>' +
        '<td class="rank' + (r.rank <= 3 ? ' top' : '') + '">' + String(r.rank).padStart(3, '0') + '</td>' +
        '<td class="pname">' + esc(r.name) + (r.on_watchlist ? '<span class="wl">WL</span>' : '') + '</td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td>' + chainTags(r.chains) + '</td>' +
        '<td class="tvlbar"><span class="bar" style="width:' + w + '%"></span><span class="val">' + usd(r.tvl_usd) + '</span></td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageTxt(r.age_days) + '</td>' +
        '<td class="num">' + r.comp_multiple.toFixed(2) + '×</td>' +
        '<td><span class="odds ' + oddsClass(r.odds) + '">' + Math.round(r.odds * 100) + '%</span></td>' +
        '<td class="tvlbar"><span class="bar" style="width:' + valW + '%;opacity:.55"></span><span class="val value">' + usd(r.implied_value_usd) + '</span></td>' +
        '</tr>';
    }).join('');
    return '<h2 class="page">The board — pre-token protocols by expected value of a launch</h2>' +
      toolbarHtml() +
      '<p class="count"><b>' + rows.length + '</b> of ' + R.rows.length + ' protocols · ' + R.watchlist_ranked + ' watchlist rows ranked · click a row for its model breakdown and farm plan</p>' +
      '<div class="tablewrap"><table><thead><tr>' +
      th('rank', '#') + th('name', 'Protocol') + th('category', 'Category') + '<th>Chains</th>' +
      th('tvl', 'TVL') + th('growth', '7d', 1) + th('age', 'No token for', 1) + th('comp', 'Comp ×', 1) + th('odds', 'Launch odds', 1) + th('implied', 'Implied value', 1) +
      '</tr></thead><tbody>' + (body || '<tr><td colspan="10" class="empty">Nothing matches those filters.</td></tr>') + '</tbody></table></div>';
  }

  /* ---------- detail ---------- */
  function compRows(r) {
    var cat = r.category;
    var peers = R.live.filter(function (l) { return l.category === cat && l.mcap_usd > 0; });
    peers.sort(function (a, b) { return b.mcap_usd - a.mcap_usd; });
    return peers.slice(0, 6);
  }

  function detailHtml(slug) {
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) return '<div class="empty">Unknown protocol.</div>';
    var steps = r.farm_steps || [];
    var peers = compRows(r);
    return '<div class="crumbs"><a href="#/board">← Board</a> · rank ' + r.rank + ' of ' + R.rows.length + (r.on_watchlist ? ' · <span class="wl-row-star">watchlist</span>' : ' · early radar (below the watchlist floor)') + '</div>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2><span class="cat">' + esc(r.category || 'Uncategorized') + '</span><span>' + chainTags(r.chains) + '</span></div>' +
      '<div class="statgrid">' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + usd(r.tvl_usd) + '</div><div class="s">' + pct(r.change_7d) + ' over 7 days</div></div>' +
      '<div class="stat"><div class="k">Runs with no token</div><div class="v">' + (r.age_days === null ? 'unknown' : r.age_days + ' d') + '</div><div class="s">listed ' + esc(r.listed_at || 'date unknown') + ' on DefiLlama</div></div>' +
      '<div class="stat"><div class="k">Implied value</div><div class="v acc">' + usd(r.implied_value_usd) + '</div><div class="s">expected value of a launch</div></div>' +
      '<div class="stat"><div class="k">Launch odds</div><div class="v">' + Math.round(r.odds * 100) + '%</div><div class="s">model claim, not a prediction</div></div>' +
      '<div class="stat"><div class="k">Token status</div><div class="v">pre-token</div><div class="s">records no mcap, gecko id or symbol</div></div>' +
      '</div>' +
      '<div class="panel"><h3>Why it is worth ' + usd(r.implied_value_usd) + '</h3>' +
      '<div class="formula">implied = TVL <span class="op">×</span> comp× <span class="op">×</span> growth× <span class="op">×</span> maturity× <span class="op">=</span> FDV proxy <span class="op">·</span> implied = FDV <span class="op">×</span> odds</div>' +
      '<div class="factors">' +
      '<div class="factor"><div class="k">TVL</div><div class="v">' + usd(r.tvl_usd) + '</div><div class="s">the snapshot\'s own figure</div></div>' +
      '<div class="factor"><div class="k">Comp ×</div><div class="v">' + r.comp_multiple.toFixed(2) + '</div><div class="s">' + (r.comp_n ? (r.comp_n === 1 ? '1 live ' + esc(r.category || '') + ' comp' : r.comp_n + ' live ' + esc(r.category || '') + ' comps') + ', regression fit' : 'fitted, no comps in category') + '</div></div>' +
      '<div class="factor"><div class="k">Growth ×</div><div class="v">' + r.growth_multiplier.toFixed(3) + '</div><div class="s">7d ' + (r.change_7d === null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + ', weight ' + R.model.growth_weight + '</div></div>' +
      '<div class="factor"><div class="k">Maturity ×</div><div class="v">' + r.maturity_multiplier.toFixed(3) + '</div><div class="s">' + (r.age_days === null ? 'age unknown → mid' : r.age_days + 'd with no token') + '</div></div>' +
      '<div class="factor"><div class="k">FDV proxy</div><div class="v">' + usd(r.fdv_proxy_usd) + '</div><div class="s">what a token may price at</div></div>' +
      '<div class="factor"><div class="k">Odds</div><div class="v">' + Math.round(r.odds * 100) + '%</div><div class="meter"><i style="width:' + Math.round(r.odds * 100) + '%"></i></div></div>' +
      '</div>' +
      '<p class="compnote">Every factor comes from the sealed snapshot: the comp multiple is this protocol\'s own multiple under a ridge regression fitted on every run to the snapshot\'s live-token protocols (ln mcap/TVL on ln TVL, ln age, 7d growth, plus its category offset, n=' + r.comp_n + '), growth is the 7-day TVL change, maturity rises with how long the protocol has run with no token. No name is special-cased — the same formula scores all ' + R.rows.length + ' rows.</p></div>' +
      '<div class="cols2">' +
      '<div class="panel"><h3>Live comps in ' + esc(r.category || 'its category') + '</h3><table class="comptable"><tr><th>Protocol</th><th class="num">MCap</th><th class="num">TVL</th><th class="num">MCap/TVL</th></tr>' +
      (peers.length ? peers.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + p.ratio.toFixed(2) + '×</td></tr>'; }).join('') : '<tr><td colspan="4" class="empty">No live comps recorded in this category.</td></tr>') +
      '</table><p class="compnote">The market\'s own values for protocols that already trade — the evidence the comp multiple is read from.</p></div>' +
      '<div class="panel"><h3>How to farm ' + esc(r.name) + '</h3><ol class="steps">' +
      steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>' + (r.farm_steps_total > steps.length ? '<p class="compnote">' + steps.length + ' of ' + r.farm_steps_total + ' steps shown — the submitted board.json carries the full plan for every row.</p>' : '') + '</div>' +
      '</div>';
  }

  /* ---------- live comps ---------- */
  var liveSort = { key: 'mcap_usd', dir: 'desc' };
  function liveHtml() {
    var q = (liveQ || '').toLowerCase();
    var rows = R.live.filter(function (l) { return !q || l.name.toLowerCase().indexOf(q) >= 0 || (l.category || '').toLowerCase().indexOf(q) >= 0; });
    var k = function (l) { return l[liveSort.key] !== null && l[liveSort.key] !== undefined ? l[liveSort.key] : -1; };
    var dir = liveSort.dir === 'asc' ? 1 : -1;
    rows.sort(function (a, b) { var va = k(a), vb = k(b); return va < vb ? -1 * dir : va > vb ? 1 * dir : 0; });
    var th2 = function (key, label, num) { return '<th data-live="' + key + '"' + (num ? ' class="num"' : '') + '>' + label + (liveSort.key === key ? '<span class="dir">' + (liveSort.dir === 'asc' ? '▲' : '▼') + '</span>' : '') + '</th>'; };
    return '<h2 class="page">Live comps — the market\'s own values</h2>' +
      '<p class="count">Protocols that already trade, by market cap: the evidence base every comp multiple is read from. Kept out of the ranked board on purpose.</p>' +
      '<div class="toolbar"><span class="search"><input id="lq" type="search" placeholder="Filter live comps…" value="' + esc(liveQ || '') + '"></span></div>' +
      '<div class="tablewrap"><table><thead><tr>' + th2('name', 'Protocol') + th2('category', 'Category') + th2('tvl_usd', 'TVL', 1) + th2('mcap_usd', 'Market cap', 1) + th2('ratio', 'MCap/TVL', 1) + th2('change_7d', '7d TVL', 1) + '</tr></thead><tbody>' +
      rows.map(function (l) {
        return '<tr><td class="pname">' + esc(l.name) + '</td><td class="cat">' + esc(l.category || '—') + '</td><td class="num">' + usd(l.tvl_usd) + '</td><td class="num">' + usd(l.mcap_usd) + '</td><td class="num">' + l.ratio.toFixed(2) + '×</td><td class="num">' + pct(l.change_7d) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  var liveQ = '';

  /* ---------- model tab ---------- */
  function modelHtml() {
    var m = R.model;
    var f = R.value_fit;
    var maxCat = 0;
    R.categories.forEach(function (c) { if (c.shrunk > maxCat) maxCat = c.shrunk; });
    var fitPanel = f === undefined ? '' :
      '<div class="panel"><h3>The value fit — refit on this snapshot, ' + f.sample_n + ' live comps, R² ' + f.r2.toFixed(3) + '</h3><p class="method">' +
      'The comp multiple is not a lookup table. On every run the model fits <span class="code">ln(mcap/TVL) = ' + f.intercept.toFixed(4) +
      ' + (' + f.tvl_slope.toFixed(4) + ')·ln(TVL) + (' + f.age_slope.toFixed(4) + ')·ln(age days) + (' + f.growth_slope.toFixed(4) + ')·tanh(7d% / 45) + category offset</span> ' +
      'by ridge-regularised least squares (λ = ' + f.ridge_lambda + ') over the ' + f.sample_n + ' protocols in this snapshot that already trade. ' +
      'Each category offset is the mean residual inside that category, shrunk toward zero by <span class="code">n/(n+' + f.offset_shrink_k + ')</span> so a category with one or two listings cannot pin a multiple. ' +
      'Residual spread: <span class="code">' + f.rmse_log.toFixed(3) + '</span> in ln space. ' +
      'Nothing here is memorised — no protocol name, no hand-set category multiple. Feed a different snapshot and every coefficient moves with it.</p>' +
      '<table class="mtable"><tr><th>Term</th><th class="num">Coefficient</th><th>Read</th></tr>' +
      [['intercept', f.intercept, 'level of the market multiple'],
       ['ln(TVL)', f.tvl_slope, 'bigger TVL → ' + (f.tvl_slope < 0 ? 'lower' : 'higher') + ' multiple per dollar locked'],
       ['ln(age days)', f.age_slope === 0 ? '0 (dropped)' : f.age_slope, f.age_slope === 0 ? 'refused by the held-out test below' : 'older protocol → ' + (f.age_slope < 0 ? 'lower' : 'higher') + ' multiple'],
       ['tanh(7d% / 45)', f.growth_slope === 0 ? '0 (dropped)' : f.growth_slope, f.growth_slope === 0 ? 'refused by the held-out test below' : '7-day TVL growth moves the multiple ' + (f.growth_slope < 0 ? 'down' : 'up')],
       ['R² / RMSE(ln)', f.r2.toFixed(3) + ' / ' + f.rmse_log.toFixed(3), 'on the same fit sample']].map(function (row) {
        return '<tr><td class="code">' + row[0] + '</td><td class="num">' + row[1] + '</td><td>' + row[2] + '</td></tr>';
      }).join('') + '</table></div>' +
      (f.term_trials === undefined || f.term_trials.length === 0 ? '' :
      '<div class="panel"><h3>Held out — what the fit earns on rows it never saw</h3>' +
      '<p class="method">A fit can always describe the sample it was measured on. The table below re-runs it with data hidden, so the number cannot be inflated by the model grading its own homework. ' +
      'K-fold hides a fifth of the live comps at a time (<span class="code">' + f.cv_folds + ' folds</span>); leave-one-out hides a single row and refits, ' + f.sample_n + ' times. ' +
      'Every held-out pass re-learns both the curve and the category offsets from its training rows only.</p>' +
      '<table class="mtable"><tr><th>Estimate</th><th class="num">R²</th><th class="num">RMSE (ln)</th><th class="num">vs. mean</th></tr>' +
      [['In sample (fit on all ' + f.sample_n + ')', f.r2, f.rmse_log, '—'],
       ['Held out, ' + f.cv_folds + '-fold', f.cv_r2, f.cv_rmse_log, f.cv_skill.toFixed(3) + '×'],
       ['Held out, leave-one-out', f.loo_r2, f.loo_rmse_log, f.loo_skill.toFixed(3) + '×']].map(function (row) {
        return '<tr><td>' + row[0] + '</td><td class="num">' + (typeof row[1] === 'number' ? row[1].toFixed(3) : row[1]) + '</td><td class="num">' + (typeof row[2] === 'number' ? row[2].toFixed(3) : row[2]) + '</td><td class="num">' + row[3] + '</td></tr>';
      }).join('') + '</table>' +
      '<p class="compnote">A "vs. mean" above 1 means the model beats always predicting the average multiple — that is the bar a fitted curve has to clear to be worth anything. ' +
      'On unseen rows the comp lands within <span class="code">±' + f.cv_multiple_mae_x.toFixed(2) + '×</span> on average.</p>' +
      '<table class="mtable"><tr><th>Term</th><th class="num">Held-out RMSE</th><th class="num">Δ vs. without</th><th>Verdict</th></tr>' +
      f.term_trials.map(function (t) {
        return '<tr><td class="code">' + esc(t.term) + '</td><td class="num">' + t.cv_rmse_log.toFixed(4) + '</td><td class="num">' + (t.delta > 0 ? '+' : '') + t.delta.toFixed(4) + '</td><td>' + (t.kept ? '<b>kept</b> — lowers held-out error' : 'dropped — no held-out gain') + '</td></tr>';
      }).join('') + '</table>' +
      '<p class="compnote">This is the honest part: <b>' + f.active_terms.join(', ') + '</b> is what the snapshot can actually support. ' +
      'A term that only fits the sample is refused here rather than shipped as if it predicted. The board still applies the growth and maturity multipliers to the <i>FDV proxy</i>, where they are a stated modelling choice, not a fitted claim.</p></div>');
    return '<h2 class="page">The model — ' + esc(R.model_version) + '</h2>' +
      '<div class="panel"><h3>Method</h3><p class="method">' +
      'Every pre-token protocol is scored by the same formula, from the sealed snapshot\'s own figures and nothing else. ' +
      '<b>FDV proxy = TVL × comp× × growth× × maturity×</b>, and the board ranks by <b>implied value = FDV proxy × launch odds</b>.<br><br>' +
      'The <b>comp multiple</b> is this protocol\'s own multiple under a regression fitted to the snapshot\'s live-token protocols — its TVL plus whichever of its age and 7-day growth survived the held-out test below — plus the offset learned for its category — clamped to <span class="code">[' + m.comp_floor + ', ' + m.comp_cap + ']</span>. ' +
      'The <b>growth multiplier</b> damps the 7-day TVL change to <span class="code">1 + ' + m.growth_weight + '·clamp(g, ' + m.growth_floor + ', ' + m.growth_cap + ')/100</span>. ' +
      'The <b>maturity multiplier</b> rises from <span class="code">' + m.maturity_floor + '</span> to <span class="code">' + (m.maturity_floor + m.maturity_range) + '</span> as the protocol\'s age with no token approaches ' + m.maturity_days + ' days. ' +
      'The <b>launch odds</b> combine the same three signals: <span class="code">' + m.odds_base + ' + ' + m.odds_growth + '·tanh(g/' + m.odds_tanh_scale + ') + ' + m.odds_age + '·min(age,' + m.odds_age_days + ')/' + m.odds_age_days + '</span>, clamped to [' + m.odds_min + ', ' + m.odds_max + ']. ' +
      'The watchlist is the floor and every one of its protocols is ranked; below it, the early radar carries only protocols that look like original farming targets — wrapped, staked, bridged and exchange-product shapes are set aside, because a wrapped asset has no app to farm and no launch of its own to wait for. ' +
      'No protocol name is special-cased anywhere.</p></div>' + fitPanel +
      '<div class="panel"><h3>Category offsets (learned residual in ln mcap/TVL, shrunk)</h3><table class="mtable"><tr><th>Category</th><th class="num">Live comps</th><th class="num">Raw median</th><th>Shrunk multiple</th></tr>' +
      R.categories.map(function (c) {
        return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td><td class="num">' + c.median.toFixed(2) + '×</td><td><div class="catbar"><i style="width:' + Math.max(1, Math.round(100 * c.shrunk / maxCat)) + '%"></i> <span style="font-family:var(--mono);font-size:11.5px">' + c.shrunk.toFixed(2) + '×</span></div></td></tr>';
      }).join('') + '</table></div>' +
      '<div class="panel"><h3>Constants</h3><table class="mtable"><tr><th>Weight</th><th>Value</th><th>Meaning</th></tr>' +
      [['shrink_k', m.shrink_k, 'median-shrink strength'], ['comp_floor / comp_cap', m.comp_floor + ' / ' + m.comp_cap, 'clamped comp ratio band'], ['growth_weight', m.growth_weight, '7-day growth damping'], ['growth_floor / cap', m.growth_floor + ' / ' + m.growth_cap, 'clamped 7d %'], ['maturity_floor', m.maturity_floor, 'maturity multiplier start'], ['maturity_days', m.maturity_days, 'age at full maturity'], ['odds_base', m.odds_base, 'base launch odds'], ['odds_growth', m.odds_growth, 'odds growth term'], ['odds_age', m.odds_age, 'odds age term'], ['odds_age_days', m.odds_age_days, 'age at full odds'], ['odds_min / max', m.odds_min + ' / ' + m.odds_max, 'odds clamp']].map(function (row) {
        return '<tr><td class="code">' + row[0] + '</td><td class="num">' + row[1] + '</td><td>' + row[2] + '</td></tr>';
      }).join('') + '</table></div>';
  }

  /* ---------- render & events ---------- */
  function render() {
    S = parseHash();
    document.querySelectorAll('#nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.tab === S.view || (S.view === 'p' && a.dataset.tab === 'board')); });
    if (S.view === 'board') $app.innerHTML = boardHtml();
    else if (S.view === 'p') $app.innerHTML = detailHtml(S.slug);
    else if (S.view === 'live') $app.innerHTML = liveHtml();
    else if (S.view === 'model') $app.innerHTML = modelHtml();
    else $app.innerHTML = '<div class="empty">Unknown view.</div>';
    syncHash();
  }

  window.addEventListener('hashchange', function () { var ns = parseHash(); S = ns; if (ns.view === 'board') { st.sort = ns.q.sort || st.sort; st.dir = ns.q.dir || st.dir; } render(); });

  $app.addEventListener('input', function (e) {
    if (e.target.id === 'f-q') { st.q = e.target.value; var sc = document.getElementById('f-q').selectionStart; render(); var el = document.getElementById('f-q'); el.focus(); el.setSelectionRange(sc, sc); }
    if (e.target.id === 'lq') { liveQ = e.target.value; var s2 = e.target.selectionStart; render(); var el2 = document.getElementById('lq'); el2.focus(); el2.setSelectionRange(s2, s2); }
  });
  $app.addEventListener('change', function (e) {
    if (e.target.id === 'f-chain') { st.chain = e.target.value; render(); }
    if (e.target.id === 'f-min') { st.min = Number(e.target.value); render(); }
    if (e.target.id === 'f-wl') { st.wl = e.target.checked; render(); }
  });
  $app.addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (chip) {
      var c = chip.dataset.cat;
      if (!c) st.cats = [];
      else { var at = st.cats.indexOf(c); if (at >= 0) st.cats.splice(at, 1); else st.cats.push(c); }
      render(); return;
    }
    var thE = e.target.closest('th[data-sort]');
    if (thE) {
      var k = thE.dataset.sort;
      if (st.sort === k) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
      else { st.sort = k; st.dir = (k === 'name' || k === 'rank') ? 'asc' : 'desc'; }
      render(); return;
    }
    var thL = e.target.closest('th[data-live]');
    if (thL) {
      var k2 = thL.dataset.live;
      if (liveSort.key === k2) liveSort.dir = liveSort.dir === 'asc' ? 'desc' : 'asc';
      else { liveSort.key = k2; liveSort.dir = k2 === 'name' ? 'asc' : 'desc'; }
      render(); return;
    }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { setHash('#/p/' + tr.dataset.slug); }
  });

  render();
})();
