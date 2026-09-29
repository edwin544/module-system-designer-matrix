/* rules.js — the composition layer.
 *
 * The five rules in `patterns.json` are predicates over a SELECTION, not over a
 * language. They are what makes the tool answer "what does asking for these
 * together mean?" rather than only "who has them?".
 *
 * A rule is stored as {when, template, cites} in patterns.json and fires here.
 * Its template obeys the same rule as templates.js — no digit, no language name,
 * no property id in the string — and `analysis/lint_templates.py` checks both
 * files, so a rule cannot smuggle in a fact the data does not carry.
 *
 * Every fired rule carries `cites`: the patterns.json entries and route records
 * it fired from, so the UI can show the evidence rather than assert grounding.
 */

const PRESENT = new Set(['full', 'partial', 'present']);

function fire(patterns, q, db) {
  const sel = (q.sel && q.sel.props) || {};
  const wants = p => PRESENT.has(sel[p]);
  // Three of the five rules judge a PROPOSED combination — a gate you would be
  // violating, a tendency you would be fighting, territory nobody occupies. A
  // recorded row is not a proposal: it is part of the measurement those rules are
  // computed from, so telling an evaluated language it goes against the measured
  // tendency is circular. They are suppressed when a language is being read out,
  // which is exactly when `sel.language` is set. The two observational rules —
  // collateral and the phase gap — are statements about the row itself and stay.
  const proposed = !(q.sel && q.sel.language);
  const pname = new Map(db.properties.map(p => [p.id, `${p.id} ${p.name}`]));
  const out = [];
  const byId = Object.fromEntries(patterns.rules.map(r => [r.id, r]));

  // `slots` is carried on the emitted statement, not just used to fill it: the
  // no-invention audit checks every token in a rendered sentence against the
  // values it was built from, and a rule that kept its slots private would be
  // the one kind of sentence that could not be audited.
  const emit = (rule, slots, cites, evidence) => out.push({
    id: rule.id, severity: rule.severity,
    text: rule.template.replace(/\{(\w+)\}/g, (m, k) => (k in slots ? String(slots[k]) : m)),
    slots, cites, why: rule.why, why_source: rule.why_source,
    evidence: rule.evidence || null, from: evidence,
  });

  /* ---------------------------------------------- R-GATE-VIOLATED (error)
   * Only fires when the precondition is explicitly denied. A precondition left
   * unselected is not a violation — it is an entailment, and `entails` reports
   * it. Conflating the two would put an error on an incomplete selection. */
  for (const g of patterns.gates) {
    if (proposed && wants(g.enables) && sel[g.requires] === 'absent')
      emit(byId['R-GATE-VIOLATED'],
           { enables: pname.get(g.enables), requires: pname.get(g.requires) },
           [`gate:${g.requires}->${g.enables}`], g);
  }

  /* --------------------------------------------------------- R-REPELS (warn) */
  const repel = new Set(byId['R-REPELS'].when.klass);
  for (const pr of patterns.pairs) {
    if (!proposed || !repel.has(pr.klass)) continue;
    if (wants(pr.a) && wants(pr.b))
      emit(byId['R-REPELS'],
           { a: pname.get(pr.a), b: pname.get(pr.b) },
           [`pair:${pr.a}/${pr.b}`], pr);
  }

  /* ---------------------------------------------------- R-NEVER-FULL (warn) */
  for (const pp of patterns.properties) {
    if (proposed && pp.full === 0 && sel[pp.id] === 'full')
      emit(byId['R-NEVER-FULL'], { property: pname.get(pp.id) },
           [`property:${pp.id}`], pp);
  }

  /* --------------------------------------------------- R-COLLATERAL (warn)
   * Fires from the computed exposure, not from the stored collateral array: the
   * stored array is the corpus-wide statement, this is the user's selection. */
  // once, for the facility that reaches the most of the selection. The rule's
  // claim is that such a facility exists and changes where mitigation goes;
  // firing it per facility repeated the same sentence with a different name in
  // it, which reads as four findings when it is one.
  const worst = (q.exposure.collateral || [])[0];
  if (worst)
    emit(byId['R-COLLATERAL'], { facility: worst.facility },
         worst.records.map(r => `route:${r}`), worst);

  /* --------------------------------------------------- R-PHASE-GAP (note) */
  if ((q.exposure.phase_gaps || []).length)
    emit(byId['R-PHASE-GAP'], {},
         q.exposure.phase_gaps.map(g => `route:${g.record}`),
         { n: q.exposure.phase_gaps.length });

  const ORDER = { error: 0, warn: 1, note: 2, info: 3 };
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

const RULES = { fire, PRESENT };
if (typeof module !== 'undefined' && module.exports) module.exports = RULES;
