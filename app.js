/* app.js — the browser shell. It holds NO knowledge about the corpus.
 *
 * Everything on screen arrives from one of four places:
 *   data/evaluation.json   the facts
 *   data/patterns.json     the statements about the corpus
 *   query.js               the six queries over the facts
 *   templates.js + rules.js  the only places prose is written
 *
 * The one rule this file obeys: it never writes a sentence about the corpus. If
 * a statement needs making, it belongs in templates.js where the linter can see
 * it. What is written here is furniture — headings, labels, controls — and the
 * labels are read out of the data.
 */

const VERDICTS = ['', 'full', 'partial', 'present', 'absent'];
/* What each severity is telling the reader to do, rather than what it is called
 * internally. A badge saying "error" on a design question is alarming and wrong;
 * these say what the statement is for. */
/* Only the two that ask the reader to do something. A badge on every statement
 * is a label, not a signal: when most of the page reads "for reference" the
 * badge stops carrying information and starts costing attention. */
const SEVERITY_LABEL = {
  error: 'no boundary here',
  warn: 'worth acting on',
};
/* The sub-property control is the evaluation framework's own LANGUAGE-SPECIFIC
 * CONSTRUCT: how each language actually realises the property. It is recorded on
 * all 880 cells, so it narrows exactly as a verdict does — asking for authority
 * control realised as an object capability is a different question from asking
 * for authority control, and the corpus answers both.
 *
 * An earlier build put the criteria's literature sub-property list here instead.
 * That list is a grouping of the 451 studies, carries no per-language verdict,
 * and could not narrow anything — so the control did nothing and said so, which
 * was wrong twice over. */
const MODE_HELP = {
  B: 'Pick the boundaries you need and the facilities your code ships. The tool reports '
   + 'who has built that combination, what it implies, and what the corpus recorded '
   + 'happening to it under attack.',
  C: 'Pick one of the evaluated languages. Its recorded row is loaded, and you can then '
   + 'adjust it to ask what a different answer would have meant.',
  A: 'A language the study never evaluated, scored from outside it with the same framework '
   + 'and fed back through the same tool. Its row loads here and is answered exactly as any '
   + 'other selection is — which is the point: the instrument outlives the survey.',
};

let DB, PAT, WALK, IX, MODE = 'B';
// WALK is the COLLECTION of walkthrough languages; WROW is the one on screen.
let WROW = null;
const sel = { props: {}, routes: [] };

/* --------------------------------------------------------------- loading */

async function load() {
  // Preferred path: the data arrived as <script> tags, which is the only way a
  // page opened from file:// can read its own files. The third datasource is the
  // walkthrough row — a language the study did not evaluate — and it loads like
  // the other two rather than being special-cased, because it is answered like
  // any other selection.
  if (window.__DATA_evaluation && window.__DATA_patterns && window.__DATA_walkthrough)
    return [window.__DATA_evaluation, window.__DATA_patterns, window.__DATA_walkthrough];
  try {
    const [a, b, c] = await Promise.all([
      fetch('data/evaluation.json').then(r => r.json()),
      fetch('data/patterns.json').then(r => r.json()),
      fetch('data/walkthrough.json').then(r => r.json()),
    ]);
    return [a, b, c];
  } catch (e) {
    // A file:// page cannot fetch a sibling file in Chrome or Safari. Say so with
    // the command that fixes it rather than failing silently.
    document.getElementById('provenance').textContent =
      'The data files could not be read. Either the generated data/*.js bundles are '
      + 'missing — rebuild them with analysis/build_file_bundle.py — or serve the '
      + 'folder with  python3 serve.py  and open the address it prints.';
    throw e;
  }
}

/* ---------------------------------------------------------------- controls */

/* Per property AND VERDICT, the constructs the corpus records, commonest first,
 * with how many languages use each.
 *
 * Keying on the verdict is not a refinement, it is the difference between a
 * correct control and a wrong one. For a property a language HAS, the field
 * records how it is realised — `object-capability`, `separate-interface`. For one
 * it does NOT have, the same field records what the language has instead —
 * `ambient-authority`, `no module parameterisation`, `no version identity`.
 * Those are descriptions of an absence, not realisations of the property.
 *
 * Offering them together produced two faults. Looking up a language with
 * authority control absent ticked `ambient-authority` under a heading that said
 * "realised as", which reads as a contradiction and is one. And asking for a
 * property at `absent` offered constructs that only ever occur at `full`, so the
 * list contained options that could not match anything.
 *
 * Seven constructs occur under both a present and an absent verdict, so the
 * vocabulary cannot be split by value — only by the verdict of the cell. */
let CONSTRUCTS = new Map();
let PROVENANCE_NOTE = '';
/* mechanism -> absence | scope | checking, published in layer 2 so the tool and
 * the paper classify a resistance the same way */
let MECHANISM_KIND = {};
function indexConstructs() {
  const by = new Map();
  for (const c of DB.cells) {
    const v = c.language_specific_construct;
    if (!v || v === 'n/a') continue;
    for (const key of [c.property + '/' + c.support,
                       ...(c.support === 'absent' ? [] : [c.property + '/present'])]) {
      if (!by.has(key)) by.set(key, new Map());
      const m = by.get(key);
      m.set(v, (m.get(v) || 0) + 1);
    }
  }
  CONSTRUCTS = new Map([...by].map(([k, m]) =>
    [k, [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))]));
}

/* What the strip is showing, which depends on whether the property is being
 * asked for or ruled out. */
const STRIP_HEAD = {
  full: 'realised as — tick to narrow',
  partial: 'realised as — tick to narrow',
  present: 'realised as — tick to narrow',
  absent: 'recorded instead as — tick to narrow',
};

function buildProps() {
  const host = document.getElementById('props');
  host.innerHTML = '';
  for (const p of [...DB.properties].sort((a, b) => a.id.localeCompare(b.id))) {
    const row = document.createElement('div');
    row.className = 'prow';
    const lab = document.createElement('label');
    lab.htmlFor = 'v-' + p.id;
    lab.innerHTML = `<span class="pid">${p.id}</span> ${p.name}`;
    lab.title = p.definition;
    const s = document.createElement('select');
    s.id = 'v-' + p.id;
    for (const v of VERDICTS) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v || '—';
      s.appendChild(o);
    }

    // the sub-property strip, revealed when the parent is asked for
    const subs = document.createElement('div');
    subs.className = 'subs hidden';
    subs.id = 'subs-' + p.id;
    const head = document.createElement('p');
    head.className = 'subhead';
    subs.appendChild(head);
    const opts = document.createElement('div');
    opts.className = 'subopts';
    subs.appendChild(opts);
    if (p.conditions && p.conditions.length) {
      const d = document.createElement('details');
      d.className = 'conds';
      d.id = 'conds-' + p.id;
      const sum = document.createElement('summary');
      sum.textContent = 'what the verdict was assessed against';
      d.appendChild(sum);
      const met = document.createElement('p');
      met.className = 'met';
      d.appendChild(met);
      const ul = document.createElement('ul');
      for (const c of p.conditions) {
        const li = document.createElement('li');
        li.dataset.cond = c.id;
        li.textContent = c.id + ' — ' + c.text.replace(/\*\*/g, '');
        ul.appendChild(li);
      }
      d.appendChild(ul);
      subs.appendChild(d);
    }

    s.addEventListener('change', () => {
      if (s.value) sel.props[p.id] = s.value; else delete sel.props[p.id];
      subs.classList.toggle('hidden', !s.value);
      fillStrip(p.id, s.value);
      collectSubs();
      run();
    });
    row.append(lab, s);
    host.append(row, subs);
  }
}

/* Fill a property's construct strip for the verdict currently being asked for.
 * Clears any ticks, because a construct chosen under one verdict is meaningless
 * under another. */
function fillStrip(prop, verdict, recorded) {
  const subs = document.getElementById('subs-' + prop);
  const head = subs.querySelector('.subhead');
  const opts = subs.querySelector('.subopts');
  opts.innerHTML = '';
  if (!verdict) { head.textContent = ''; return; }
  head.textContent = STRIP_HEAD[verdict] || STRIP_HEAD.present;
  for (const [name, n] of CONSTRUCTS.get(prop + '/' + verdict) || []) {
    const l = document.createElement('label');
    l.className = 'sublab';
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.className = 'sub';
    c.dataset.property = prop;
    c.value = name;
    c.addEventListener('change', () => { collectSubs(); run(); });
    const count = document.createElement('span');
    count.className = 'subn';
    count.textContent = String(n);
    l.append(c, document.createTextNode(' ' + name), count);
    // A looked-up language HAS the construct it realises a property with, so that
    // is ticked. It does not realise a property it lacks — there the field
    // records what it has instead, so that is marked and left unticked. The rule
    // is the verdict's, not the field's: ticked where the language does it that
    // way, marked where the study is describing an absence.
    if (recorded && name === recorded) {
      if (verdict === 'absent') {
        l.classList.add('is-recorded');
        const tag = document.createElement('span');
        tag.className = 'rectag';
        tag.textContent = 'this one';
        l.insertBefore(tag, count);
      } else {
        c.checked = true;
      }
    }
    opts.appendChild(l);
  }
}

/* Mark, per property, which numbered conditions a chosen language actually met.
 * Sub-properties were never scored per language and cannot be filled in — but the
 * CONDITIONS were, in every cell's `support_conditions`, and that is the thing a
 * reader looking at the strip is really asking to see. */
function fillConditions(lang) {
  for (const p of DB.properties) {
    const box = document.getElementById('conds-' + p.id);
    if (!box) continue;
    const met = box.querySelector('.met');
    const items = [...box.querySelectorAll('li')];
    for (const li of items) li.classList.remove('yes', 'no');
    if (!lang) { met.textContent = ''; continue; }
    const cell = IX.cell.get(lang + '/' + p.id);
    const rec = cell && cell.support_conditions;
    if (!rec || rec === 'n/a') {
      met.textContent = 'No condition record for this language and property.';
      continue;
    }
    met.textContent = `${lang} recorded: ${rec}`
      + (cell.partial_route && cell.partial_route !== 'n/a'
         ? ` — partial via ${cell.partial_route}` : '');
    // "N1; N2; N3 (all)" names the ones met; "named partial route" names none
    const named = (rec.match(/N\d/g) || []);
    const all = /\(all\)/.test(rec);
    for (const li of items) {
      if (all || named.includes(li.dataset.cond)) li.classList.add('yes');
      else if (named.length || all) li.classList.add('no');
    }
  }
}

/* Selected sub-properties, grouped by the property they refine. */
function collectSubs() {
  sel.subs = {};
  for (const c of document.querySelectorAll('.sub:checked')) {
    (sel.subs[c.dataset.property] = sel.subs[c.dataset.property] || []).push(c.value);
  }
}

function buildRoutes() {
  const host = document.getElementById('routes');
  host.innerHTML = '';
  const groups = [['universal', 'Universal — attempted against every language'],
                  ['extended', 'Extended — attempted where the language has the facility']];
  for (const [klass, heading] of groups) {
    const rs = PAT.routes.filter(r => r.klass === klass);
    if (!rs.length) continue;
    const h = document.createElement('p');
    h.className = 'rgroup'; h.textContent = heading;
    host.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'rgrid';
    for (const r of rs) {
      const l = document.createElement('label');
      l.className = 'rlab';
      l.title = r.why;
      const c = document.createElement('input');
      c.type = 'checkbox'; c.value = r.id; c.className = 'route';
      c.addEventListener('change', () => {
        sel.routes = [...document.querySelectorAll('.route:checked')].map(x => x.value);
        run();
      });
      l.append(c, document.createTextNode(' ' + r.id));
      grid.appendChild(l);
    }
    host.appendChild(grid);
  }
}

function buildLangs() {
  const s = document.getElementById('lang');
  s.innerHTML = '<option value="">—</option>';
  for (const l of DB.languages) {
    const o = document.createElement('option');
    o.value = l.id; o.textContent = l.id;
    s.appendChild(o);
  }
  s.addEventListener('change', () => {
    const id = s.value;
    document.getElementById('langnote').textContent = '';
    // `sel.language` is what tells the rule engine this is a recorded row being
    // read out rather than a combination being proposed
    sel.language = id || undefined;
    if (!id) { run(); return; }
    const l = DB.languages.find(x => x.id === id);
    document.getElementById('langnote').textContent =
      `${l.version} — module construct: ${l.module_construct}`;
    // load the recorded row: the selection becomes exactly what was measured
    sel.props = {};
    for (const p of DB.properties) {
      const v = IX.verdict(id, p.id);
      sel.props[p.id] = v;
      document.getElementById('v-' + p.id).value = v;
      const strip = document.getElementById('subs-' + p.id);
      strip.classList.toggle('hidden', !v);
      // built for THIS language's verdict: the construct it realises the property
      // with is ticked, and where the property is absent the construct records
      // what it has instead, so that is marked and left unticked
      const cell = IX.cell.get(id + '/' + p.id);
      fillStrip(p.id, v, cell && cell.language_specific_construct);
    }
    collectSubs();
    // The facilities this language actually ships, which the corpus records by
    // having attempted them: a route with a record is a route the language has.
    // Leaving these unticked made a lookup report every route the STUDY tried
    // rather than every route the language offers.
    const has = new Set(DB.routes.filter(r => r.language === id).map(r => r.route));
    for (const c of document.querySelectorAll('.route')) c.checked = has.has(c.value);
    sel.routes = [...has].sort();
    fillConditions(id);
    run();
  });
}

/* ----------------------------------------------------------------- asking */

function familyBlock() {
  // Placement is COMPUTED, here, for whatever is on screen — a walkthrough row, or a
  // combination the reader typed. QUERY.place reads the cascade and thresholds from
  // patterns.json, so this is the same rule that placed the 44 and there is no second
  // copy of it. A recorded language still uses its recorded entry, which the same
  // rule reproduces for all 44.
  const lang = sel.language || '';
  if (lang) {
    const lf = PAT.language_families.find(x => x.language === lang);
    if (lf) {
      const fam = PAT.families.find(f => f.id === lf.primary);
      return { recorded: { ...lf, definition: fam ? fam.definition : '' } };
    }
  }
  if (MODE === 'A' && WROW) {
    const p = QUERY.place(PAT, sel.props);
    if (p) {
      p.language = WROW.language;
      p.placed_by = 'patterns.json family_rule, computed for this row';
      p.note = 'This row was not part of the study. The family is computed from its '
             + 'verdicts by the published rule, not fitted to it.';
      return { recorded: p };
    }
  }
  const m = QUERY.match(IX, sel);
  if (!m.n || !m.selected) return null;
  const set = new Set(m.languages);
  const dist = PAT.families.map(f => ({
    family: f.id, size: f.members.length,
    n: f.members.filter(x => set.has(x)).length,
    // the family's own definition, carried so the sentence can say what the label
    // MEANS rather than only assert it — with each group's size, because "0.92"
    // means nothing without knowing it is nine properties
    definition: f.definition,
    centroid: f.centroid,
    groups: f.property_groups,
  })).filter(d => d.n > 0);
  return {
    distribution: dist,
    total: PAT.families.length,
    members: Object.fromEntries(PAT.families.map(f => [f.id, f.members])),
  };
}

function gapBlock() {
  // a gap fires only when the selection asks for everything the gap asks for, at
  // the gap's own verdict — a weaker test would attach the section's sentence to
  // a selection it is not about
  return PAT.gaps.filter(g =>
    g.requires.every(p => sel.props[p] === g.verdict));
}

function ask() {
  const q = {
    sel,
    match: QUERY.match(IX, sel),
    entails: QUERY.entails(IX, sel),
    excludes: QUERY.excludes(IX, sel),
    counterfactual: QUERY.counterfactual(IX, sel),
    nearestMiss: QUERY.nearestMiss(IX, sel),
    exposure: QUERY.exposure(IX, sel),
    // the same selection without the realisation filter, so the tool can say what
    // the narrowing cost rather than only what it left
    without_subs: QUERY.match(IX, { props: sel.props }),
    nature: QUERY.nature(IX, sel),
    containment: QUERY.containment(IX, sel, MECHANISM_KIND),
    profile: QUERY.profile(IX, sel),
    typicality: QUERY.typicality(IX, sel),
    unconfined: QUERY.unconfined(IX, sel),
  };
  q.family = familyBlock();
  q.gaps = gapBlock();
  // step 9's leave-one-out result for this language, when one is being read out
  q.validation = sel.language
    ? PAT.validation.find(v => v.language === sel.language) : null;
  q.validation_summary = PAT.validation_summary[0];
  q.group_definitions = Object.fromEntries(
    PAT.property_groups.map(g => [g.id, g.definition]).filter(([, d]) => d));

  // which property groups the selection draws on, and which of its properties
  // fall in each: the basis for saying whether this is one decision or several
  const asked = Object.keys(sel.props);
  q.groups_touched = PAT.property_groups
    .filter(g => g.id !== 'INDEPENDENT')
    .map(g => ({ id: g.id, properties: g.properties,
                 selected: g.properties.filter(p => asked.includes(p)) }))
    .filter(g => g.selected.length > 0);

  // NOTE: an earlier version also offered corpus-wide "attracting" pairs here.
  // It contradicted the graded profile — recommending properties that only 17% of
  // the matching languages actually provide — because pair attraction is measured
  // across all 44 while the profile is conditioned on the languages that meet the
  // requirement. Conditioned on the match is the answer a practitioner needs, so
  // the unconditional one was removed rather than shown beside it.

  // the walkthrough row, when that is what is being shown
  q.walkthrough = MODE === 'A' ? WROW : null;
  // the family of every evaluated language, so a sentence naming near languages can
  // say what KIND of design each one is rather than only how far away it is
  q.families_index = PAT.language_families;
  // property groups the selection draws on that leave-one-out does not reproduce
  const picked = new Set(Object.keys(sel.props));
  q.fragile_groups = PAT.property_groups.filter(
    g => g.stable === false && g.properties.some(p => picked.has(p)));
  return q;
}

/* --------------------------------------------------------------- rendering */

function chipLabel(cite) {
  // the id itself, minus its kind prefix: the chip is the record's own name
  return String(cite).split(':').slice(1).join(':');
}

function evidencePanel(cite) {
  const r = PROVENANCE.resolve(IX, PAT, cite);
  const box = document.createElement('div');
  box.className = 'prov';
  if (!r) {
    box.textContent = cite;
    return box;
  }
  const h = document.createElement('p');
  h.className = 'provhead';
  h.textContent = r.headline + (r.verdict ? ' — ' + r.verdict : '');
  box.appendChild(h);
  const dl = document.createElement('dl');
  for (const f of r.fields) {
    const dt = document.createElement('dt');
    dt.textContent = f.label;
    const dd = document.createElement('dd');
    dd.textContent = f.value;
    if (f.kind === 'cmd') dd.className = 'mono';
    if (f.kind === 'prose') dd.className = 'prose';
    // a row the corpus has no value for is shown, and shown as such
    if (f.kind === 'absent') dd.className = 'absent';
    dl.append(dt, dd);
  }
  box.appendChild(dl);
  return box;
}

/* Chips: one per cited record, grouped by kind, each opening the record it names.
 * The group keeps its own count visible — how many records a sentence rests on is
 * part of what the sentence claims, so it is never hidden behind a truncation. */
const CHIP_CAP = 24;

function evidenceNode(cites) {
  const groups = PROVENANCE.group(cites);
  if (!groups.length) return null;

  const d = document.createElement('details');
  d.className = 'ev';
  const sum = document.createElement('summary');
  sum.textContent = 'evidence — '
    + groups.map(g => `${g.n} ${g.kind}`).join(', ');
  d.appendChild(sum);

  const panel = document.createElement('div');
  panel.className = 'provpanel';

  for (const g of groups) {
    const strip = document.createElement('div');
    strip.className = 'chips';
    const render = limit => {
      strip.innerHTML = '';
      for (const id of g.ids.slice(0, limit)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip k-' + g.kind;
        b.textContent = chipLabel(id);
        b.onclick = () => {
          const open = panel.querySelector('.prov[data-id="' + CSS.escape(id) + '"]');
          for (const x of panel.querySelectorAll('.prov')) x.remove();
          for (const x of panel.querySelectorAll('.chip.on')) x.classList.remove('on');
          if (open) return;
          const p = evidencePanel(id);
          p.dataset.id = id;
          b.classList.add('on');
          strip.after(p);
        };
        strip.appendChild(b);
      }
      if (g.ids.length > limit) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'chip more';
        more.textContent = `+${g.ids.length - limit}`;
        more.onclick = () => render(g.ids.length);
        strip.appendChild(more);
      }
    };
    render(CHIP_CAP);
    panel.appendChild(strip);
  }
  d.appendChild(panel);
  return d;
}

function whyNode(st) {
  if (!st.why) return null;
  const d = document.createElement('details');
  d.className = 'why';
  const sum = document.createElement('summary');
  sum.textContent = st.why_source === 'link'
    ? 'why this is claimed — quoted from the paper'
    : 'why this is claimed';
  const p = document.createElement('p');
  p.textContent = st.why;
  d.append(sum, p);
  if (st.evidence && st.evidence.section) {
    const cite = document.createElement('p');
    cite.className = 'cite';
    cite.textContent = st.evidence.section;
    d.appendChild(cite);
  }
  return d;
}

/* Typesetting, and nothing else. Every node here is built from text a template
 * produced; this decides how it LOOKS and never what it says.
 *
 * Three treatments, in order of how sure we can be:
 *   **…**     the one clause a skimming reader should not miss. The template
 *             marks it; this renders it.
 *   P00       a property identifier. Unambiguous by shape, so it is safe to
 *             pick out of running text.
 *   figures   digit runs, set in tabular numerals so columns of them line up
 *             and a reader can compare at a glance.
 *
 * Language names are NOT picked out of running text. The tokeniser that would do
 * it read the `d` of a TypeScript `shapes.d.ts` as the language `d`, and a
 * cosmetic version of that mistake is still a mistake. They are marked only where
 * a slot value is exactly a language name — the same sound rule the audit uses. */
const PROPID_RE = /\bP\d\d\b/g;
/* A figure is a digit run standing on its own. The first version matched digits
 * anywhere and cut `cpp20-modules`, `idris2` and `lean4` in half — which is the
 * same mistake, in a new place, as reading the `d` of `shapes.d.ts` as a
 * language: tokenising by pattern without asking what the pattern is inside. */
const FIGURE_RE = /(?<![A-Za-z0-9._-])\d[\d,]*(?:\.\d+)?%?(?![A-Za-z0-9._-])/g;

function spansOf(text, langs) {
  const spans = [];
  const claim = (i, j, cls) => {
    if (spans.some(s => i < s.end && j > s.start)) return;
    spans.push({ start: i, end: j, cls });
  };
  // longest first, so `cpp20-modules` is claimed before anything inside it
  for (const name of [...langs].sort((a, b) => b.length - a.length)) {
    const re = new RegExp('(?<![A-Za-z0-9+_-])' + name.replace(/[+]/g, '\\$&')
                          + '(?![A-Za-z0-9+_-])', 'g');
    let m;
    while ((m = re.exec(text))) claim(m.index, m.index + m[0].length, 'lang-chip');
  }
  for (const re of [PROPID_RE, FIGURE_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)))
      claim(m.index, m.index + m[0].length, re === PROPID_RE ? 'pid-chip' : 'fig');
  }
  return spans.sort((a, b) => a.start - b.start);
}

/* Typesetting, and nothing else. Every node here is built from text a template
 * produced; this decides how it LOOKS and never what it says.
 *
 *   **...**   the one clause a skimming reader should not miss
 *   P00       a property identifier, unambiguous by shape
 *   figures   digit runs, in tabular numerals so they can be compared
 *   names     language names, and ONLY where a slot value is exactly a list of
 *             them — never picked out of running text, because the tokeniser
 *             that does that reads file extensions as languages
 */
function typeset(host, text, langs) {
  for (const [i, part] of text.split('**').entries()) {
    if (!part) continue;
    const target = i % 2 ? document.createElement('strong') : host;
    let at = 0;
    for (const sp of spansOf(part, langs)) {
      if (sp.start > at) target.appendChild(document.createTextNode(part.slice(at, sp.start)));
      const el = document.createElement(sp.cls === 'fig' ? 'span' : 'code');
      el.className = sp.cls;
      el.textContent = part.slice(sp.start, sp.end);
      target.appendChild(el);
      at = sp.end;
    }
    if (at < part.length) target.appendChild(document.createTextNode(part.slice(at)));
    if (i % 2) host.appendChild(target);
  }
}

/* The languages this statement's own slots name, so typesetting marks only those.
 * A slot names languages when its value is a list of language ids and nothing
 * else — free text that happens to contain one does not count. */
function namedLanguages(st) {
  const out = new Set();
  for (const v of Object.values(st.slots || {})) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const toks = v.split(/,| and /).map(x => x.trim()).filter(Boolean);
    if (toks.length && toks.every(t => LANGSET.has(t))) toks.forEach(t => out.add(t));
  }
  return out;
}
let LANGSET = new Set();

/* A table is the same facts as the sentence, set out so they can be compared down
 * a column. Cells are typeset like any other text, so figures line up and
 * identifiers read as identifiers. */
function tableNode(t, langs) {
  const tbl = document.createElement('table');
  tbl.className = 'facts';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const c of t.columns) {
    const th = document.createElement('th');
    th.textContent = c;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tb = document.createElement('tbody');
  for (const row of t.rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      typeset(td, String(cell), langs);
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  tbl.append(thead, tb);
  return tbl;
}

function card(st) {
  const el = document.createElement('article');
  el.className = 'st ' + st.severity;
  if (SEVERITY_LABEL[st.severity]) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = SEVERITY_LABEL[st.severity];
    el.appendChild(badge);
  }
  const t = document.createElement('p');
  t.className = 'text';
  typeset(t, st.text, namedLanguages(st));
  el.appendChild(t);
  if (st.table) el.appendChild(tableNode(st.table, namedLanguages(st)));
  const w = whyNode(st); if (w) el.appendChild(w);
  const e = evidenceNode(st.cites); if (e) el.appendChild(e);
  return el;
}

function run() {
  const q = ask();
  const host = document.getElementById('statements');
  host.innerHTML = '';

  if (!Object.keys(sel.props).length && MODE !== 'A') {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Set at least one property to begin.';
    host.appendChild(p);
    return;
  }

  const RULE_SECTION = {
    'R-PHASE-GAP': 'gives', 'R-COLLATERAL': 'gives',
    'R-GATE-VIOLATED': 'built', 'R-REPELS': 'with', 'R-NEVER-FULL': 'without',
  };
  const RULE_RANK = { 'R-PHASE-GAP': 55, 'R-COLLATERAL': 52 };
  const rules = RULES.fire(PAT, q, DB).map(
    r => ({ ...r, audience: 'advice', section: RULE_SECTION[r.id] || 'with',
            rank: RULE_RANK[r.id] || 50 }));
  let all = [...rules, ...TEMPLATES.render(q, DB)];

  // An unprobed walkthrough row is an EMPTY selection, and an empty selection
  // trivially satisfies every language — "44 of 44 satisfy this" is true and
  // says nothing. Everything but the statement explaining why the row is empty
  // is suppressed, so the screen cannot look like a result.
  if (q.walkthrough && !q.walkthrough.meta.evaluated)
    all = all.filter(s => s.id === 'walkthroughPending');

  // Advice first, grouped in the order a practitioner reads in; everything that
  // is about the STUDY rather than about their decision goes behind a disclosure
  // at the end. The tool still says how far to trust it — it just stops leading
  // with it.
  // The headings are the questions, in the words a practitioner would use. An
  // earlier set named the sections abstractly — "Who has built this", "What comes
  // with it" — which reads as a table of contents for the study rather than as
  // answers to anything.
  const HEAD = {
    verdict: 'Summary',
    built:  'Has this been built before?',
    study:  'What should I read as a reference implementation?',
    design: 'What kind of design is this?',
    with:   'What else comes with it?',
    without: 'What am I unlikely to get?',
    rare:   'What makes this design rare?',
    gives:  'What breaks it, and where?',
  };
  // the summary first, then the sections it summarises
  for (const key of ['verdict', 'built', 'study', 'design', 'with', 'without', 'rare',
                     'gives']) {
    const group = all.filter(s => s.audience === 'advice' && s.section === key)
                     .sort((a, b) => (a.rank || 50) - (b.rank || 50));
    if (!group.length) continue;
    const h = document.createElement('h3');
    h.className = 'sec' + (key === 'verdict' ? ' sec-summary' : '');
    h.appendChild(document.createTextNode(HEAD[key]));
    const n = document.createElement('span');
    n.className = 'seccount';
    n.textContent = String(group.length);
    h.appendChild(n);
    host.appendChild(h);
    for (const st of group) {
      const c = card(st);
      if (key === 'verdict') c.classList.add('is-summary');
      host.appendChild(c);
    }
  }

  const method = all.filter(s => s.audience === 'method');
  if (method.length) {
    const d = document.createElement('details');
    d.className = 'methodbox';
    const sum = document.createElement('summary');
    sum.textContent = `Evidence and validation — ${method.length} note`
                    + (method.length === 1 ? '' : 's') + ' on coverage, method and how '
                    + 'far to trust the above';
    d.appendChild(sum);
    for (const st of method) d.appendChild(card(st));
    if (PROVENANCE_NOTE) {
      const p = document.createElement('p');
      p.className = 'provnote';
      p.textContent = PROVENANCE_NOTE;
      d.appendChild(p);
    }
    host.appendChild(d);
  }
}

/* ------------------------------------------------------------------- modes */

/* Load the walkthrough row into the same controls every other selection uses.
 * Nothing here is special-cased downstream: once the row carries verdicts it is a
 * selection like any other, which is what makes it a use of the tool rather than
 * a table beside it. */
function loadWalkthrough(lang) {
  const rows = (WALK && WALK.languages) || [];
  WROW = rows.find(r => r.language === lang) || rows[0] || null;
  sel.props = {};
  sel.subs = {};
  sel.language = undefined;
  if (!WROW) return;
  for (const p of DB.properties) {
    const cell = WROW.cells.find(c => c.property === p.id);
    const v = cell && cell.support;
    const box = document.getElementById('v-' + p.id);
    box.value = v || '';
    document.getElementById('subs-' + p.id).classList.toggle('hidden', !v);
    if (v) sel.props[p.id] = v;
  }
}

function setMode(m) {
  MODE = m;
  for (const b of document.querySelectorAll('#modes button'))
    b.classList.toggle('on', b.dataset.mode === m);
  document.getElementById('langpick').classList.toggle('hidden', m !== 'C');
  if (m !== 'C') {
    sel.language = undefined;
    fillConditions(null);
    for (const c of document.querySelectorAll('.route')) c.checked = false;
    sel.routes = [];
  }
  document.getElementById('modehelp').textContent = MODE_HELP[m];
  document.getElementById('walkpick').classList.toggle('hidden',
    m !== 'A' || ((WALK && WALK.languages || []).length < 2));
  if (m === 'A') loadWalkthrough(document.getElementById('walklang').value);
  run();
}

/* -------------------------------------------------------------------- boot */

(async function () {
  [DB, PAT, WALK] = await load();
  // the walkthrough picker is filled from the datasource, so adding a language to
  // the collection adds it to the tool with no code change here
  {
    const rows = (WALK && WALK.languages) || [];
    const wp = document.getElementById('walklang');
    for (const r of rows) {
      const o = document.createElement('option');
      o.value = r.language;
      o.textContent = r.language + (r.meta && r.meta.evaluated
        ? '' : ` — ${(r.meta && r.meta.scored) || 0} of ${(r.meta && r.meta.of) || 0} scored`);
      wp.appendChild(o);
    }
    wp.onchange = () => { loadWalkthrough(wp.value); run(); };
    document.getElementById('walknote').textContent = rows.length
      ? `${rows.length} language${rows.length > 1 ? 's' : ''} scored from outside the study. `
        + 'Its family is computed here by the same rule the evaluated languages are placed by.'
      : 'No walkthrough language has been scored yet.';
  }
  IX = QUERY.index(DB);

  const c = PAT.meta.counts;
  document.getElementById('provenance').textContent =
    `${DB.languages.length} languages, ${DB.cells.length} evaluated cells, `
    + `${DB.routes.length} adjudicated bypass records, ${DB.adjudications.length} route `
    + `adjudications. Every verdict below is a recorded observation from `
    + `${DB.meta.source_of_truth}.`;
  // the footer is one line a practitioner might read; the counts behind it belong
  // with the rest of the evidence, not under the summary they just finished
  document.getElementById('footnote').textContent =
    `All ${DB.cells.length} verdicts on this page come from probes that were built and `
    + `run. Nothing here is written by hand: every sentence is a template filled from `
    + `the data files.`;
  PROVENANCE_NOTE = `The statements are generated from `
    + `${c.properties + c.pairs + c.gates + c.families} computed patterns and `
    + `${c.rules} composition rules, over ${DB.cells.length} evaluated cells, `
    + `${DB.routes.length} adjudicated bypass records and ${DB.adjudications.length} `
    + `route adjudications.`;

  LANGSET = new Set(DB.languages.map(l => l.id));
  MECHANISM_KIND = Object.fromEntries(
    (PAT.mechanism_kinds || []).map(m => [m.mechanism, m.kind]));
  indexConstructs();
  buildProps(); buildRoutes(); buildLangs();

  document.getElementById('clearprops').onclick = () => {
    sel.props = {};
    for (const p of DB.properties) {
      document.getElementById('v-' + p.id).value = '';
      document.getElementById('subs-' + p.id).classList.add('hidden');
      fillStrip(p.id, '');
    }
    collectSubs();
    run();
  };
  document.getElementById('clearroutes').onclick = () => {
    for (const c of document.querySelectorAll('.route')) c.checked = false;
    sel.routes = []; run();
  };
  document.getElementById('alluniversal').onclick = () => {
    const uni = new Set(QUERY.UNIVERSAL);
    for (const c of document.querySelectorAll('.route')) c.checked = uni.has(c.value);
    sel.routes = [...document.querySelectorAll('.route:checked')].map(x => x.value);
    run();
  };
  for (const b of document.querySelectorAll('#modes button'))
    b.onclick = () => setMode(b.dataset.mode);

  setMode('B');
})();
