/* query.js — the six queries the reasoning engine is built on.
 *
 * Pure and synchronous. Every function takes the loaded evaluation.json and a
 * selection, and returns a plain object. No prose, no formatting, no opinions:
 * templates (step 4) turn these results into sentences.
 *
 * A selection is:
 *   { props:  { P10: 'full', P13: 'present', ... },     verdict wanted per property
 *     subs:   { P10: ['object-capability'] },            the REALISATION wanted
 *     routes: ['ffi', 'reflection'] }                    routes the design will ship
 *
 * `subs` narrows by the evaluation framework's own language-specific construct —
 * how a language actually realises the property. It is recorded on all 880 cells,
 * so it filters like a verdict does: asking for authority control realised as an
 * object capability is a different question from asking for authority control,
 * and the corpus can answer both.
 *
 * Verdict values a selection may ask for:
 *   'full' | 'partial' | 'absent'   the recorded verdict, exactly
 *   'present'                       full or partial
 *
 * THREE DENOMINATORS THAT LOOK ALIKE AND ARE NOT. Getting these wrong produced
 * three false results while building steps 1-2, so every count returned here is
 * labelled with which one it is:
 *   1. cell-level bypass   (weakest link over a cell's routes)  146 defeated / 33 resisted
 *   2. route-level, universal (the six-route comparison axis)   196 / 76
 *   3. route-level, all routes (universal + extended)           262 / 99
 * `exposure` returns all three separately and never adds them together.
 */

const UNIVERSAL = ['ffi', 'reflection', 'serialization', 'dynamic-load',
                   'unsafe-cast', 'metaprogramming'];

/* ---------------------------------------------------------------- indexing */

function index(db) {
  const cell = new Map();          // "lang/prop" -> cell
  for (const c of db.cells) cell.set(c.language + '/' + c.property, c);

  const byLangProp = new Map();    // "lang/prop" -> [route records]
  for (const r of db.routes) {
    const k = r.language + '/' + r.property;
    if (!byLangProp.has(k)) byLangProp.set(k, []);
    byLangProp.get(k).push(r);
  }

  const routeById = new Map();     // "lang/prop/route" -> the route record
  for (const r of db.routes) routeById.set(r.id, r);

  const adj = new Map();           // "lang/prop" -> [adjudications]
  for (const a of db.adjudications) {
    const k = a.language + '/' + a.property;
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push(a);
  }

  return {
    db,
    cell, byLangProp, routeById, adj,
    languages: db.languages.map(l => l.id).sort(),
    properties: db.properties.map(p => p.id).sort(),
    verdict: (lang, prop) => (cell.get(lang + '/' + prop) || {}).support,
  };
}

/* ------------------------------------------------------------ 1. match */
/* Languages whose recorded verdicts satisfy every property in the selection. */

function satisfies(ix, lang, prop, wanted) {
  const v = ix.verdict(lang, prop);
  if (v === undefined) return false;
  if (wanted === 'present') return v === 'full' || v === 'partial';
  return v === wanted;
}

/* The realisation the cell records — the framework's `language_specific_construct`.
 * A selection naming constructs for a property keeps only the languages that
 * realise it one of those ways. */
function realises(ix, lang, prop, wanted) {
  if (!wanted || !wanted.length) return true;
  const c = ix.cell.get(lang + '/' + prop);
  return !!c && wanted.includes(c.language_specific_construct);
}

function match(ix, sel) {
  const props = sel.props || {};
  const subs = sel.subs || {};
  const languages = ix.languages.filter(l =>
    Object.entries(props).every(([p, w]) => satisfies(ix, l, p, w))
    && Object.entries(subs).every(([p, want]) => realises(ix, l, p, want)));
  return {
    languages,
    n: languages.length,
    total: ix.languages.length,
    selected: Object.keys(props).length,
  };
}

/* ---------------------------------------------------------- 2. entails */
/* Properties at `full` in EVERY matching language. Exhaustive over the match
 * set, so this is not a correlation claim: it says the combination does not
 * occur in this corpus without them. Undefined when nothing matches. */

function entails(ix, sel) {
  const m = match(ix, sel);
  if (m.n === 0) return { properties: [], basis: 0 };
  const selected = new Set(Object.keys(sel.props || {}));
  const properties = ix.properties.filter(p =>
    !selected.has(p) && m.languages.every(l => ix.verdict(l, p) === 'full'));
  return { properties, basis: m.n };
}

/* --------------------------------------------------------- 3. excludes */
/* Properties at `full` in NO matching language. */

function excludes(ix, sel) {
  const m = match(ix, sel);
  if (m.n === 0) return { properties: [], basis: 0 };
  const selected = new Set(Object.keys(sel.props || {}));
  const properties = ix.properties.filter(p =>
    !selected.has(p) && !m.languages.some(l => ix.verdict(l, p) === 'full'));
  return { properties, basis: m.n };
}

/* --------------------------------------------------- 4. counterfactual */
/* Drop each selected property in turn and re-count. Shows which requirement is
 * doing the constraining work before anything is built. */

function counterfactual(ix, sel) {
  const props = sel.props || {};
  const base = match(ix, sel).n;
  const dropped = Object.keys(props).map(p => {
    const rest = Object.fromEntries(Object.entries(props).filter(([k]) => k !== p));
    const n = match(ix, { props: rest }).n;
    return { property: p, without: n, gain: n - base };
  }).sort((a, b) => b.gain - a.gain);
  return { base, dropped, binding: dropped.length ? dropped[0].property : null };
}

/* ------------------------------------------------------ 5. nearestMiss */
/* Languages that fail the selection on exactly k properties, smallest k first.
 * The point of the tool when a selection matches nothing: it names what each
 * near-miss would have to change. */

function nearestMiss(ix, sel, limit = 10) {
  const props = Object.entries(sel.props || {});
  // `total` belongs on every return, not only the populated one: the empty
  // selection is exactly where a missing field goes unnoticed, and the
  // 200-selection cross-check against the Python oracle found it there.
  if (!props.length) return { distance: null, total: 0, languages: [] };
  const scored = ix.languages.map(l => {
    const missed = props.filter(([p, w]) => !satisfies(ix, l, p, w))
                        .map(([p, w]) => ({ property: p, wanted: w, actual: ix.verdict(l, p) }));
    for (const [p, want] of Object.entries(sel.subs || {})) {
      if (!want.length || missed.some(m => m.property === p)) continue;
      if (!realises(ix, l, p, want)) {
        const c = ix.cell.get(l + '/' + p);
        missed.push({ property: p, wanted: want.join(' or '),
                      actual: c ? c.language_specific_construct : undefined });
      }
    }
    return { language: l, distance: missed.length, missing: missed };
  }).filter(x => x.distance > 0)
    .sort((a, b) => a.distance - b.distance || a.language.localeCompare(b.language));
  const best = scored.length ? scored[0].distance : null;
  const tied = scored.filter(x => x.distance === best);
  // `total` is how many languages miss by that much; `languages` is what is shown.
  // Without the former the sentence reads as if the shown set were the whole set,
  // and up to 44 languages can tie at distance 1.
  return { distance: best, total: tied.length, languages: tied.slice(0, limit) };
}

/* --------------------------------------------------------- 6. exposure */
/* What the corpus records happening to the SELECTED properties in the MATCHING
 * languages, optionally narrowed to the routes a design says it will ship.
 *
 * Returns the three denominators separately. `cells` counts cells (weakest
 * link); `universal` and `extended` count route records. They are never summed. */

function exposure(ix, sel) {
  const m = match(ix, sel);
  const props = Object.keys(sel.props || {});
  const wanted = sel.routes && sel.routes.length ? new Set(sel.routes) : null;

  // `reachable` is every record against the selection; `records` is the subset
  // on the routes the design says it will ship. Both are needed: the difference
  // between them is the exposure a route restriction actually removes, which is
  // the question a team banning a facility is really asking.
  const reachable = [];
  for (const l of m.languages) {
    for (const p of props) {
      for (const r of (ix.byLangProp.get(l + '/' + p) || [])) reachable.push(r);
    }
  }
  const records = wanted ? reachable.filter(r => wanted.has(r.route)) : reachable.slice();

  const tally = rs => ({
    defeated: rs.filter(r => r.outcome === 'defeated').length,
    resisted: rs.filter(r => r.outcome === 'resisted').length,
  });
  const uni = records.filter(r => r.route_class === 'universal');
  const ext = records.filter(r => r.route_class === 'extended');

  // cell-level: a cell counts once, at its weakest link
  const cellKeys = new Set(records.map(r => r.language + '/' + r.property));
  const cells = { defeated: 0, resisted: 0 };
  for (const k of cellKeys) {
    const o = (ix.cell.get(k) || {}).bypass_outcome;
    if (o === 'defeated') cells.defeated++;
    else if (o === 'resisted') cells.resisted++;
  }

  // which facility did the defeating, and by what mechanism
  const byFacility = new Map();
  for (const r of records.filter(x => x.outcome === 'defeated')) {
    const k = r.facility || '(unrecorded)';
    if (!byFacility.has(k)) byFacility.set(k, { facility: k, mechanism: r.mechanism, n: 0, records: [] });
    const e = byFacility.get(k); e.n++; e.records.push(r.id);
  }

  // routes never tried against these cells, with the recorded reason
  const untried = [];
  for (const l of m.languages) {
    for (const p of props) {
      for (const a of (ix.adj.get(l + '/' + p) || [])) {
        if (wanted && !wanted.has(a.route)) continue;
        untried.push({ language: l, property: p, route: a.route, status: a.status,
                       reason: a.reason == null ? null : ix.db.reasons[a.reason] });
      }
    }
  }

  // ------------------------------------------------- the bypass-route axis
  // Per route, restricted to the selected properties in the matching languages.
  const rollup = rs => {
    const by = new Map();
    for (const r of rs) {
      if (!by.has(r.route))
        by.set(r.route, { route: r.route, route_class: r.route_class, attempts: 0,
                          defeated: 0, resisted: 0, properties: new Set(),
                          languages: new Set(), facilities: new Set(), records: [] });
      const e = by.get(r.route);
      e.attempts++;
      if (r.outcome === 'defeated') e.defeated++;
      else if (r.outcome === 'resisted') e.resisted++;
      e.properties.add(r.property);
      e.languages.add(r.language);
      if (r.outcome === 'defeated' && r.facility) e.facilities.add(r.facility);
      e.records.push(r.id);
    }
    return [...by.values()].map(e => ({ ...e,
      properties: [...e.properties].sort(),
      languages: [...e.languages].sort(),
      facilities: [...e.facilities].sort(),
    })).sort((a, b) => b.defeated - a.defeated || a.route.localeCompare(b.route));
  };

  const selectedRoutes = rollup(records);
  // Routes the design did NOT select that still defeat the selection. Only
  // meaningful once a restriction has been stated, so null when none has.
  // Unfiltered on purpose: the shipped and excluded sets have to partition the
  // reachable records exactly, or the tool is quietly losing evidence. Showing
  // only the ones that defeat is the template's choice, not the accounting's.
  const otherRoutes = wanted
    ? rollup(reachable.filter(r => !wanted.has(r.route)))
    : null;
  // Routes the design named that the corpus never attempted here: the honest
  // answer to "we ship this route" is sometimes "nobody tested it".
  const routesNotAttempted = wanted
    ? [...wanted].filter(r => !records.some(x => x.route === r)).sort()
    : [];

  // ---------------------------------------------- collateral within a language
  // One facility defeating SEVERAL selected properties in the same language. A
  // route decision is therefore not a per-property decision, which is the whole
  // reason the route axis is an input rather than a report.
  const pair = new Map();
  for (const r of records.filter(x => x.outcome === 'defeated' && x.facility)) {
    const k = r.language + '\u0000' + r.facility;
    if (!pair.has(k))
      pair.set(k, { language: r.language, facility: r.facility, mechanism: r.mechanism,
                    properties: new Set(), routes: new Set(), records: [] });
    const e = pair.get(k);
    e.properties.add(r.property); e.routes.add(r.route); e.records.push(r.id);
  }
  const collateral = [...pair.values()]
    .map(e => ({ ...e, properties: [...e.properties].sort(),
                 routes: [...e.routes].sort(), n: e.properties.size }))
    .filter(e => e.n > 1)
    .sort((a, b) => b.n - a.n || a.language.localeCompare(b.language));

  // ------------------------------------------- defeats with no recorded location
  // A defeat whose facility was never pinned to a file and a line. In this corpus
  // every one of them is a record still pending adjudication: an adjudicated
  // defeat always carries its location, so the citation is pending rather than
  // missing. The tool reports the shortfall anyway rather than letting a reader
  // assume the citation is there — an uncited defeat is the one claim here that
  // rests on an assertion, and it has to be visible as such.
  const unlocated = records.filter(r => r.outcome === 'defeated' && !r.facility_evidence);

  // ------------------------------------------------------- the phase window
  // A defeat whose phase differs from the phase at which the cell's violation
  // was refused: a gate placed where the rule fires does not see the crossing.
  const phaseGaps = [];
  for (const r of records) {
    if (r.outcome !== 'defeated') continue;
    const c = ix.cell.get(r.language + '/' + r.property);
    const refused = c && c.violation_phase;
    if (!refused || refused === 'unknown' || !r.phase || r.phase === 'unknown') continue;
    if (refused !== r.phase)
      phaseGaps.push({ language: r.language, property: r.property, route: r.route,
                       checked_at: refused, crossed_at: r.phase, record: r.id });
  }

  return {
    basis: m.n,
    records,
    reachable_n: reachable.length,
    phase_gaps: phaseGaps,
    unlocated: unlocated.map(r => ({ id: r.id, route: r.route, route_class: r.route_class,
                                     outcome_source: r.outcome_source })),
    counts: { cells, universal: tally(uni), extended: tally(ext),
              universal_n: uni.length, extended_n: ext.length },
    facilities: [...byFacility.values()].sort((a, b) => b.n - a.n),
    untried,
    selected_routes: selectedRoutes,
    other_routes: otherRoutes,
    routes_not_attempted: routesNotAttempted,
    collateral,
  };
}

/* ------------------------------------------------------- 7. graded profile
 * What the matching languages ALSO provide, per property, as a proportion rather
 * than all-or-nothing.
 *
 * `entails` and `excludes` answer the logical question — does this combination
 * ever occur without X. That is the right question for a claim in a paper and the
 * wrong one for a practitioner: it fires on the extremes and throws away
 * everything in between. Asking for hiding, type abstraction and separate
 * compilation, `excludes` names one property; the graded view names five that
 * fewer than a third of the matching languages provide, which is what "you are
 * unlikely to get this" actually means. It also separates present from full, so
 * "every one of them has it, but only a third fully" can be said at all. */

function profile(ix, sel) {
  const m = match(ix, sel);
  const selected = new Set(Object.keys(sel.props || {}));
  if (!m.n) return { basis: 0, properties: [] };
  const rows = ix.properties.filter(p => !selected.has(p)).map(p => {
    const full = m.languages.filter(l => ix.verdict(l, p) === 'full').length;
    const partial = m.languages.filter(l => ix.verdict(l, p) === 'partial').length;
    return { property: p, full, partial, present: full + partial,
             share: Math.round(100 * (full + partial) / m.n) };
  });
  rows.sort((a, b) => b.present - a.present || b.full - a.full
                      || a.property.localeCompare(b.property));
  return { basis: m.n, properties: rows };
}

/* ------------------------------------------------------- 8. typicality
 * Which of the matching languages are representative of the group and which are
 * the odd ones out, by agreement with the group's modal verdict across ALL
 * properties — not just the selected ones, because what makes a language a good
 * reference implementation is the whole design, not the part that was asked for.
 *
 * The answer to "what should I read the source of?". */

function typicality(ix, sel) {
  const m = match(ix, sel);
  if (m.n < 2) return { basis: m.n, languages: [], mode: {} };
  const mode = {};
  for (const p of ix.properties) {
    const count = {};
    for (const l of m.languages) {
      const v = ix.verdict(l, p);
      count[v] = (count[v] || 0) + 1;
    }
    mode[p] = Object.entries(count)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  const languages = m.languages.map(l => ({
    language: l,
    agrees: ix.properties.filter(p => ix.verdict(l, p) === mode[p]).length,
    of: ix.properties.length,
  })).sort((a, b) => b.agrees - a.agrees || a.language.localeCompare(b.language));
  return { basis: m.n, mode, languages };
}

/* ------------------------------------------------------- 9. unconfined
 * Cells where the plain, obvious violation was simply ACCEPTED — no bypass route,
 * no clever construct. The corpus records this separately from a bypass and it is
 * a different fact: a bypassable boundary is one an attacker must know a trick to
 * cross, and an unconfined one is not a boundary at all. 51 cells across the
 * corpus hold a property at full or partial while the naive violation compiles
 * and runs. */

function unconfined(ix, sel) {
  const m = match(ix, sel);
  const props = Object.keys(sel.props || {});
  const out = [];
  for (const l of m.languages) {
    for (const p of props) {
      const c = ix.cell.get(l + '/' + p);
      if (c && c.violation_outcome === 'accepted')
        out.push({ language: l, property: p, support: c.support,
                   enforcement: c.enforcement_type, phase: c.violation_phase,
                   // which part was not enforced, for a `partial` verdict that
                   // would otherwise read as contradicting the accepted violation
                   partial_route: c.partial_route });
    }
  }
  return out.sort((a, b) => a.language.localeCompare(b.language)
                            || a.property.localeCompare(b.property));
}

/* ------------------------------------------------------- 10. what kind of boundary
 * Per selected property, over the matching languages: is it enforced by the
 * toolchain or left to discipline, what is the UNIT it applies to, and at which
 * stage is the violation refused. Three fields recorded on every cell and never
 * spoken — and the unit is the one a practitioner is most often wrong about,
 * because `private` means per-declaration in one language and per-module in the
 * next while the keyword looks identical. */

function nature(ix, sel) {
  const m = match(ix, sel);
  const props = Object.keys(sel.props || {});
  if (!m.n) return { basis: 0, properties: [] };
  const tally = (cells, field) => {
    const c = new Map();
    for (const x of cells) {
      const v = x[field];
      if (!v || v === 'n/a' || v === 'unknown') continue;
      c.set(v, (c.get(v) || 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                           .map(([value, n]) => ({ value, n }));
  };
  const rows = props.map(p => {
    const cells = m.languages.map(l => ix.cell.get(l + '/' + p)).filter(Boolean);
    return {
      property: p,
      basis: cells.length,
      enforcement: tally(cells, 'enforcement_type'),
      granularity: tally(cells, 'granularity'),
      phase: tally(cells, 'violation_phase'),
    };
  }).filter(r => r.enforcement.length || r.granularity.length || r.phase.length);
  return { basis: m.n, properties: rows };
}

/* -------------------------------------------------- 11. what ever stopped a route
 * For each route that broke something in this selection: has the corpus ever
 * recorded that route failing — and if so, HOW.
 *
 * The distinction is the whole value, and it is not one the study set out to
 * make. A route can fail two ways:
 *
 *   CONTAINED   the facility is there and the boundary held anyway — a printer
 *               that respects visibility, reflection that requires `opens`,
 *               a splice the elaborator re-checks. Executed evidence that the
 *               facility and the boundary can coexist.
 *   ABSENT      nothing stopped it except the facility not existing. No language
 *               in the corpus kept the facility and held the line.
 *
 * Treating those alike is the mistake a generic "restrict X" list makes:
 * serialization and reflection have well-evidenced containment designs, and
 * unsafe-cast has none in 45 attempts.
 *
 * The evidence is corpus-wide, not confined to the matching languages, because a
 * route resisted nowhere in the selection may well have been resisted elsewhere —
 * and that is precisely what a reader wants to know. Callers must say so. */

function containment(ix, sel, kinds) {
  const m = match(ix, sel);
  const props = Object.keys(sel.props || {});
  const wanted = sel.routes && sel.routes.length ? new Set(sel.routes) : null;

  // the routes that actually broke something here
  const hit = new Set();
  for (const l of m.languages)
    for (const p of props)
      for (const r of (ix.byLangProp.get(l + '/' + p) || []))
        if (r.outcome === 'defeated' && (!wanted || wanted.has(r.route))) hit.add(r.route);

  const out = [];
  for (const route of [...hit].sort()) {
    const all = ix.db.routes.filter(r => r.route === route);
    const held = all.filter(r => r.outcome === 'resisted');
    // The classification is PUBLISHED in patterns.json, not inferred here. An
    // earlier version read it off the mechanism name with a regex and disagreed
    // with the corpus on seven records: the `scope` kind — a boundary that held
    // for a reason that is neither an absent facility nor a check — has no naming
    // convention a pattern could detect, so those were being counted as checks.
    const kindOf = m => (kinds && kinds[m]) || 'checking';
    const absent = held.filter(r => kindOf(r.mechanism) === 'absence');
    const scoped = held.filter(r => kindOf(r.mechanism) === 'scope');
    const contained = held.filter(r => kindOf(r.mechanism) === 'checking');
    const how = new Map();
    for (const r of contained) how.set(r.mechanism, (how.get(r.mechanism) || 0) + 1);
    out.push({
      route,
      fell: all.filter(r => r.outcome === 'defeated').length,
      held: held.length,
      absent: absent.length,
      scoped: scoped.length,
      contained: contained.length,
      mechanisms: [...how.entries()].sort((a, b) => b[1] - a[1])
                    .map(([mechanism, n]) => ({ mechanism, n })),
      // the claim rests on the whole population of that route's records, not only
      // the ones that were contained: "never held while present" is a statement
      // about every attempt, and a route with no resistance at all cites its
      // defeats or it cites nothing
      records: [...held.map(r => r.id), ...all.filter(r => r.outcome === 'defeated')
                                               .map(r => r.id)],
      contained_records: contained.map(r => r.id),
    });
  }
  return out.sort((a, b) => b.contained - a.contained || b.fell - a.fell);
}

/* ------------------------------------------------------------------ place */
/* Classify ANY verdict vector against the studied languages, from the rule
 * published in patterns.json. This is the one implementation: the 44 recorded
 * placements, a walkthrough language, and a combination a reader typed by hand all
 * go through it, and it reads the cascade and thresholds from the datasource rather
 * than restating them. Nothing here names a language.
 *
 * Returns null when the vector does not cover every property the rule scores over,
 * because a partial vector cannot be placed and guessing would be worse than
 * silence. */
function place(patterns, verdicts) {
  const rule = patterns.family_rule && patterns.family_rule[0];
  if (!rule) return null;
  const groups = rule.groups, score = rule.score, th = rule.thresholds;
  for (const ps of Object.values(groups))
    for (const p of ps)
      if (!verdicts || !verdicts[p]) return null;

  const gs = {};
  for (const [g, ps] of Object.entries(groups))
    gs[g] = Math.round((ps.reduce((a, p) => a + score[verdicts[p]], 0) / ps.length) * 1000) / 1000;

  // the cascade, in the published order — first match wins
  let primary = null;
  for (const step of rule.cascade) {
    const t = step.test;
    if (t === 'otherwise'
      || (t.startsWith('CHECKED <') && gs.CHECKED < th.CHECKED)
      || (t.startsWith('SANDBOX >= SANDBOX_threshold and')
          && gs.SANDBOX >= th.SANDBOX && gs.PARAMETRIC >= th.PARAMETRIC)
      || (t === 'SANDBOX >= SANDBOX_threshold' && gs.SANDBOX >= th.SANDBOX)
      || (t === 'PARAMETRIC >= PARAMETRIC_threshold' && gs.PARAMETRIC >= th.PARAMETRIC)) {
      primary = step.family;
      break;
    }
  }

  const aff = {};
  for (const f of patterns.families) {
    let d = 0;
    for (const g of Object.keys(gs)) d += Math.abs(gs[g] - f.centroid[g]);
    aff[f.id] = Math.round((1 - d / Object.keys(gs).length) * 1000) / 1000;
  }
  const order = Object.entries(aff).sort((a, b) => b[1] - a[1]);
  const sec = order.slice(1).filter(x => x[1] >= order[0][1] - rule.margin).map(x => x[0]);
  const defn = (patterns.families.find(f => f.id === primary) || {}).definition || '';
  return {
    primary, definition: defn,
    affinity: Object.fromEntries(order), group_scores: gs,
    secondary: sec.length > rule.max_secondary ? [] : sec,
    weak_fit: order[0][1] < rule.weak_fit_below,
    computed: true,
  };
}

/* ---------------------------------------------------------------- export */

const QUERY = { index, match, realises, entails, excludes, counterfactual, nearestMiss, exposure,
                profile, typicality, unconfined, nature, containment, place, UNIVERSAL };
if (typeof module !== 'undefined' && module.exports) module.exports = QUERY;
