/* provenance.js — turn a citation into the evidence behind it.
 *
 * Every statement the tool renders carries `cites`: ids of the cells, route
 * records, adjudications and pattern entries it was computed from. This resolves
 * one of those ids to the record it names.
 *
 * The rule here is narrower than the one templates.js obeys. A template may not
 * state a fact; this file may not state ANYTHING. It reads fields out of the two
 * data files and labels them. Labels are furniture — "outcome", "facility",
 * "phase" are the field's own name — and every value is copied verbatim, never
 * reworded, rounded or summarised. `analysis/check_step8.py` checks that each
 * rendered value appears in the source JSON exactly as shown.
 *
 * That is what makes the grounding claim inspectable rather than asserted: a
 * sentence saying a boundary was defeated expands to the file and line of the
 * construct that defeated it, the command that was run and what it printed.
 */

/* A field is dropped rather than shown empty: "n/a", null and "unknown" are the
 * corpus's own way of saying a question did not apply, and a blank row invites
 * the reader to think something is missing. */
const EMPTY = new Set([null, undefined, '', 'n/a', 'none', 'unknown']);
const keep = v => !EMPTY.has(v);

function field(label, value, kind) {
  return keep(value) ? [{ label, value: String(value), kind: kind || 'text' }] : [];
}

/* A list is kept as its elements, so each one can be checked against the source
 * rather than the joined string: a member containing a comma would otherwise
 * make a verbatim list look like a reworded one. */
function listField(label, values) {
  const vs = (values || []).map(String).filter(v => keep(v));
  return vs.length ? [{ label, value: vs.join('; '), values: vs, kind: 'list' }] : [];
}

/* The one place this file says something the data does not: that the data says
 * nothing. A defeat with no recorded location is weaker evidence than one with
 * a file and a line, and hiding the row would let a reader assume the citation
 * is there. `MISSING` marks it as the tool's own statement, not a corpus value. */
const NOT_RECORDED = 'not recorded in the corpus';
function absentField(label) {
  return [{ label, value: NOT_RECORDED, kind: 'absent' }];
}

/* ------------------------------------------------------------------ resolve */

function resolve(ix, patterns, cite) {
  const [kind, ...rest] = String(cite).split(':');
  const id = rest.join(':');
  switch (kind) {

    case 'cell': {
      const c = ix.cell.get(id);
      if (!c) return null;
      const pr = c.probes || {};
      return { kind, id, headline: `${c.language} · ${c.property} ${c.property_name}`,
        verdict: c.support,
        fields: [
          ...field('support', c.support),
          ...field('conditions met', c.support_conditions),
          ...field('partial because', c.partial_route),
          ...field('enforcement', c.enforcement_type),
          ...field('violation outcome', c.violation_outcome),
          ...field('violation phase', c.violation_phase),
          ...field('construct', c.language_specific_construct),
          ...field('granularity', c.granularity),
          ...field('origin', c.support_origin),
          ...field('evidence', c.evidence_source),
          ...field('completeness', c.evidence_completeness),
          ...field('bypass outcome', c.bypass_outcome),
          ...(pr.support ? [
            ...field('support probe', pr.support.cmd, 'cmd'),
            ...field('expected output', pr.support.match, 'cmd'),
            ...field('support probe verdict', pr.support.verdict),
          ] : []),
          ...(pr.violation ? [
            ...field('violation probe', pr.violation.cmd, 'cmd'),
            ...field('expected output', pr.violation.match, 'cmd'),
            ...field('violation probe verdict', pr.violation.verdict),
          ] : []),
        ] };
    }

    case 'route': {
      const r = (ix.routeById && ix.routeById.get(id)) || null;
      if (!r) return null;
      return { kind, id, headline: `${r.language} · ${r.property} · ${r.route}`,
        verdict: r.outcome,
        fields: [
          ...field('outcome', r.outcome),
          ...field('route class', r.route_class),
          ...field('facility', r.facility),
          // the load-bearing one: the construct, in the probe, at a line number.
          // When a defeat has none, say so rather than leaving the row out.
          ...(r.facility_evidence
              ? field('found at', r.facility_evidence, 'cmd')
              : (r.outcome === 'defeated' ? absentField('found at') : [])),
          ...field('mechanism', r.mechanism),
          ...field('phase', r.phase),
          ...field('command', r.cmd, 'cmd'),
          ...field('output', r.output, 'cmd'),
          ...field('toolchain', r.toolchain),
          ...field('how adjudicated', r.outcome_source),
          ...field('reasoning', r.conditions, 'prose'),
        ] };
    }

    case 'adj': {
      const [lang, prop, route] = id.split('/');
      const a = (ix.adj.get(lang + '/' + prop) || []).find(x => x.route === route);
      if (!a) return null;
      const reason = a.reason == null ? null : ix.db.reasons[a.reason];
      return { kind, id, headline: `${lang} · ${prop} · ${route}`, verdict: a.status,
        fields: [...field('status', a.status), ...field('recorded reason', reason, 'prose')] };
    }

    case 'language': {
      const l = ix.db.languages.find(x => x.id === id);
      if (!l) return null;
      return { kind, id, headline: l.id, verdict: null,
        fields: [...field('version', l.version),
                 ...field('module construct', l.module_construct),
                 ...field('toolchain', l.toolchain)] };
    }

    case 'property': {
      const p = ix.db.properties.find(x => x.id === id);
      if (!p) return null;
      const pat = patterns.properties.find(x => x.id === id);
      return { kind, id, headline: `${p.id} ${p.name}`, verdict: pat ? pat.role : null,
        fields: [
          ...field('definition', p.definition, 'prose'),
          ...listField('sub-properties', p.sub_properties),
          ...(p.conditions || []).flatMap(c => field(c.id, c.text, 'prose')),
          ...(pat ? [...field('full', pat.full), ...field('partial', pat.partial),
                     ...field('absent', pat.absent)] : []),
        ] };
    }

    case 'gate': {
      const [requires, enables] = id.split('->');
      const g = patterns.gates.find(x => x.requires === requires && x.enables === enables);
      if (!g) return null;
      return { kind, id, headline: `${g.requires} → ${g.enables}`, verdict: g.kind,
        fields: [...field('checked', g.checked),
                 ...listField('exceptions', g.exceptions),
                 ...field('stated in', g.why, 'prose'),
                 ...field('section', (g.evidence || {}).section)] };
    }

    case 'pair': {
      const [a, b] = id.split('/');
      const p = patterns.pairs.find(x => x.a === a && x.b === b);
      if (!p) return null;
      return { kind, id, headline: `${p.a} ${p.a_name} · ${p.b} ${p.b_name}`, verdict: p.klass,
        fields: [...field('both present', p.both_present),
                 ...field('lift', p.lift_present),
                 ...field('Jaccard', p.jaccard),
                 ...field('stated as', p.why, 'prose')] };
    }

    case 'family': {
      const f = patterns.families.find(x => x.id === id);
      if (!f) return null;
      return { kind, id, headline: f.name, verdict: null,
        fields: [...field('definition', f.definition, 'prose'),
                 ...listField('members', f.members),
                 ...Object.entries(f.centroid).flatMap(([k, v]) => field(k, v))] };
    }

    case 'property_group': {
      const g = patterns.property_groups.find(x => x.id === id);
      if (!g) return null;
      return { kind, id, headline: g.id, verdict: g.stable ? 'reproduced' : 'not reproduced',
        fields: [...listField('properties', g.properties),
                 ...listField('held up by', g.depends_on),
                 ...field('stated as', g.why, 'prose')] };
    }

    case 'validation': {
      const v = (patterns.validation_summary || []).find(x => x.id === id);
      if (!v) return null;
      return { kind, id, headline: v.id, verdict: v.beats_baseline ? null : null,
        fields: [
          ...field('languages held out', v.languages),
          ...field('grouping reproduced', v.groups_reproduced),
          ...field('family reproduced', v.families_reproduced),
          ...field('placed in another family', v.families_misplaced),
          ...listField('could not be placed', v.unplaceable),
          ...listField('group that dissolves', v.dissolving_group),
          ...field('outcome predictions', v.exposure_tested),
          ...field('correct', v.exposure_hits),
          ...field('the constant rule scores', v.baseline_hits),
          ...field('predicted a defeat that did not occur', v.false_defeat),
          ...field('predicted resistance that did not hold', v.false_resist),
          ...field('stated as', v.why, 'prose'),
        ] };
    }

    case 'gap': {
      const g = patterns.gaps.find(x => x.id === id);
      if (!g) return null;
      return { kind, id, headline: g.id, verdict: g.verdict,
        fields: [...listField('requires', g.requires),
                 ...listField('matches', g.matches),
                 ...field('stated as', g.blurb, 'prose'),
                 ...field('in full', g.why, 'prose'),
                 ...field('section', (g.evidence || {}).section)] };
    }

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ grouping
 * A statement can cite hundreds of records. Chips are grouped by kind and the
 * group reports its own size, so a long citation list stays readable without the
 * count being hidden — the number of records behind a sentence is itself part of
 * what the sentence is claiming. */

const ORDER = ['route', 'cell', 'adj', 'language', 'property', 'property_group', 'gate',
               'pair', 'family', 'gap', 'validation'];

function group(cites) {
  const by = new Map();
  for (const c of cites || []) {
    const k = String(c).split(':')[0];
    if (!by.has(k)) by.set(k, []);
    if (!by.get(k).includes(c)) by.get(k).push(c);
  }
  return ORDER.filter(k => by.has(k)).map(k => ({ kind: k, ids: by.get(k), n: by.get(k).length }));
}

const PROVENANCE = { resolve, group, ORDER, NOT_RECORDED };
if (typeof module !== 'undefined' && module.exports) module.exports = PROVENANCE;
