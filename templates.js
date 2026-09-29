/* templates.js — the sentences, and the rule that keeps them honest.
 *
 * Every statement the tool makes is produced here, from a template plus a query
 * result. The templates are the ONLY place prose is written, and they obey one
 * rule that makes the "grounded" claim checkable rather than asserted:
 *
 *     NO TEMPLATE STRING MAY CONTAIN A DIGIT OR A LANGUAGE NAME.
 *
 * Every number, every language, every property arrives from a query. Words like
 * "every", "no" and "none" are structural quantifiers over a computed set, not
 * facts about the corpus; the sets they quantify over are computed.
 * `analysis/lint_templates.py` enforces the rule.
 *
 * Each rendered statement carries `cites`: the cell ids or route record ids it
 * was computed from, so the UI can show the evidence behind any sentence.
 */

/* ------------------------------------------------------------- grammar aids */
/* Pluralisation and list-joining are grammar, not evidence. */

const plural = (n, one, many) => (n === 1 ? one : many);
const list = xs => {
  if (!xs.length) return '';
  if (xs.length === 1) return xs[0];
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
};
/* `list` is for short items. A row that is itself a clause reads wrong joined by
 * "and", so clause lists are joined by semicolon instead. */
const clauses = xs => xs.join('; ');
/* The name leads and the identifier follows in brackets. Nobody remembers twenty
 * identifiers, and a sentence that opens with one makes the reader look it up
 * before they can read the clause. */
const names = (db, ids) => {
  const by = new Map(db.properties.map(p => [p.id, p.name]));
  return ids.map(i => (by.get(i) ? `${by.get(i)} (${i})` : i));
};

/* ------------------------------------------------------------------ severity
 * info    a statement about the corpus
 * note    something the designer should know but is not a problem
 * warn    rare, or fighting a measured tendency
 * error   the selection does not occur and the corpus says why
 *
 * ------------------------------------------------------------------ audience
 * The reader is a developer, architect or reviewer building software in a
 * language they did not choose and cannot change. They need to know what their
 * boundary buys, what it costs and where it gives way — not how the study was
 * validated. Every statement therefore declares who it is for:
 *
 *   advice   answers a question a practitioner actually has
 *   method   tells them how far to trust the answer
 *
 * `method` statements are true and worth keeping — a tool that hides its own
 * limits is worse than one that states them — but they belong behind "how this
 * was checked", not in front of someone deciding what to do on Monday. The split
 * exists because the first version put a leave-one-out accuracy figure in the
 * main pane, which answered a question nobody had asked.
 *
 * ------------------------------------------------------------------- section
 * The order a practitioner reads in, not the order the queries run in:
 *   who      who has already built this
 *   what     what the selection is, as a design
 *   with     what comes with it, what it rules out, what usually joins it
 *   gives    where it gives way
 *   method   how far to trust the above
 */

const T = {

  /* ---------------------------------------------------------- 1. extensional */

  matchSome: {
    severity: 'info',
    audience: 'advice', section: 'built', rank: 10,
    // a lookup already knows which language it asked about
    when: q => !(q.sel && q.sel.language) && q.match.n > 0,
    render: (q, db) => ({
      text: `{n} of {total} {langword} in the corpus {satisfy} this selection: {languages}.`,
      slots: {
        n: q.match.n, total: q.match.total,
        langword: plural(q.match.total, 'language', 'languages'),
        satisfy: plural(q.match.n, 'satisfies', 'satisfy'),
        languages: list(q.match.languages),
      },
      cites: q.match.languages.map(l => `language:${l}`),
    }),
  },

  matchNone: {
    severity: 'error',
    audience: 'advice', section: 'built', rank: 10,
    when: q => q.match.n === 0 && q.match.selected > 0,
    render: q => ({
      text: `No language in the corpus satisfies this selection. It is an unoccupied ` +
            `region: the combination has not been built, or not by anything this study ` +
            `evaluated.`,
      slots: {},
      cites: [],
    }),
  },

  /* ------------------------------------------------- 1b. narrowed by realisation
   * The framework records, per cell, the language-specific construct that
   * realises the property. Asking for one is a real narrowing — it is scored on
   * every cell — so this reports what the narrowing cost, which is the part a
   * reader cannot see from the result alone.
   */

  realisationNarrowed: {
    severity: 'note',
    audience: 'advice', section: 'built', rank: 20,
    // Not in a language lookup. There the realisations are filled in FROM the
    // language, so the user narrowed nothing — reporting a narrowing that cost
    // nothing, across all twenty properties, was a wall of text answering a
    // question nobody asked.
    when: q => !(q.sel && q.sel.language)
               && Object.values((q.sel && q.sel.subs) || {}).some(v => v.length)
               && !!q.without_subs,
    render: (q, db) => {
      const subs = q.sel.subs;
      const parents = Object.keys(subs).filter(p => subs[p].length).sort();
      // "realised as" is right for a property the language has and wrong for one
      // it does not: there the construct records what it has INSTEAD
      const rows = parents.map(p =>
        `${names(db, [p])[0]} `
        + ((q.sel.props || {})[p] === 'absent' ? 'recorded instead as ' : 'realised as ')
        + list(subs[p].map(x => `\u201c${x}\u201d`)));
      const dropped = q.without_subs.n - q.match.n;
      return {
        text: `**You narrowed by the construct recorded for each property: {rows}.** ` +
              `That is a real filter — the study records one for every cell, either ` +
              `how the property is realised or, where it is absent, what the language ` +
              `has instead — and {effect}. {tail}`,
        slots: {
          rows: clauses(rows),
          // "leaves the field from 1 language to 1" was the old wording when the
          // filter changed nothing; a sentence should not need arithmetic to say
          // that nothing happened
          effect: dropped > 0
            ? `it cuts the field from ${q.without_subs.n} `
              + `${plural(q.without_subs.n, 'language', 'languages')} to ${q.match.n}`
            : 'it leaves the field unchanged',
          tail: dropped > 0
            ? `The ${dropped} ${plural(dropped, 'language', 'languages')} dropped `
              + `${plural(dropped, 'meets', 'meet')} your verdicts but `
              + `${plural(dropped, 'builds', 'build')} it a different way, so `
              + `${plural(dropped, 'it is', 'they are')} worth a look before you rule `
              + `the realisation out.`
            : 'Every language meeting your verdicts already realises it that way, so '
              + 'the narrowing costs you nothing here.',
        },
        cites: parents.map(p => `property:${p}`),
      };
    },
  },

  /* --------------------------------------------------------------- 12. in short
   * The last thing on the page, and the only one that crosses sections: how
   * narrow the design is, what distinguishes it, what actually broke it, and
   * whether that route has ever been held elsewhere.
   *
   * It synthesises and does not advise. "The study records that route held N
   * times elsewhere, by X" is the last thing it says; whether that transfers to
   * the reader's system is the judgement §6 makes and this cannot.
   */

  inShort: {
    severity: 'info',
    audience: 'advice', section: 'verdict', rank: 10,
    when: q => q.match.n > 0 && (q.exposure.records.length > 0
                                 || (q.counterfactual.dropped || []).length > 0),
    render: (q, db) => {
      const d = (q.counterfactual.dropped || [])[0];
      const worst = [...(q.exposure.selected_routes || [])]
        .filter(r => r.defeated > 0)
        .sort((a, b) => b.defeated - a.defeated)[0];
      const heldElsewhere = worst
        ? (q.containment || []).find(c => c.route === worst.route) : null;
      const fam = q.family && (q.family.recorded
        ? q.family.recorded.primary
        : ((q.family.distribution || []).slice()
            .sort((a, b) => b.n - a.n)[0] || {}).family);
      const un = q.unconfined || [];
      return {
        text: `{reach}{family}{narrow}{none}{risk}{held}`,
        slots: {
          // in a lookup the match set is that one language by construction, so the
          // count is an artefact of the question and the language is the answer
          reach: q.sel && q.sel.language
            ? `**This is ${q.sel.language}.** `
            : `**${q.match.n} of ${q.match.total} languages build this.** `,
          family: fam ? `It is a ${fam} design. ` : '',
          // the most consequential thing on the page when it is present, and the
          // summary was leaving it out
          // "N of the boundaries" is always plural: the set is what is being
          // counted from. Pluralising it on N gave "1 of the boundary here",
          // which is the same slip as an earlier "1 of the pair you selected".
          none: un.length
            ? `${un.length} of the boundaries here `
              + `${plural(un.length, 'was', 'were')} not enforced at all — the plain `
              + `violation was accepted, with no bypass needed. `
            : '',
          narrow: d && d.gain > 0 && !(q.sel && q.sel.language)
            ? `${names(db, [d.property])[0]} is what narrows it — without that one `
              + `requirement the field would be ${d.without}. `
            : '',
          // "nothing was recorded breaking it, which means it was not tested" was
          // wrong, and wrong in the dangerous direction: it treated two different
          // situations as one. No attempts at all is untested. Attempts that all
          // failed is tested and held — weakly, and the sentence has to say how
          // weakly rather than convert it into an absence of evidence.
          risk: worst
            ? `What actually broke it here was ${worst.route}, ${worst.defeated} of `
              + `${worst.attempts} ${plural(worst.attempts, 'attempt', 'attempts')} — `
              + `a facility of the language, not a failure of the module system. `
            : (q.exposure.records.length
               ? `Nothing broke it: `
                 + (q.exposure.records.length === 1
                    ? 'the one recorded attempt failed. '
                    : `all ${q.exposure.records.length} recorded attempts failed. `)
                 + `That is too little to conclude the boundary holds — the routes tried `
                 + `did not work, and others were not tried. `
               : `No attempt was recorded against it at all, so the evidence here is `
                 + `silent rather than reassuring. `),
          held: heldElsewhere && heldElsewhere.contained > 0
            ? `That same route was held ${heldElsewhere.contained} `
              + `${plural(heldElsewhere.contained, 'time', 'times')} elsewhere in the `
              + `study with the facility still present, by `
              + `${list(heldElsewhere.mechanisms.slice(0, 2).map(m => m.mechanism))} — `
              + `so a design that contains it exists, though this study never tested `
              + `whether it transfers.`
            : (heldElsewhere
               ? `Nothing in the study ever held that route while the facility was `
                 + `present, so removal is the only containment on record.`
               : ''),
        },
        cites: [...(worst ? worst.records.map(r => `route:${r}`) : []),
                ...un.map(x => `cell:${x.language}/${x.property}`),
                ...(fam ? [`family:${fam}`] : []),
                ...(d ? [`property:${d.property}`] : [])],
      };
    },
  },

  /* ------------------------------------------------------- 1a. the walkthrough
   * A language the study never evaluated, scored from outside it with the same
   * framework. Everything else in this file treats it as an ordinary selection,
   * which is the whole claim: the instrument works on a language the survey did
   * not cover. These two statements are the only ones that know it is special —
   * and the first exists so the tool cannot quietly present an unfinished row as
   * a finished one.
   */

  walkthroughPending: {
    severity: 'warn',
    audience: 'advice', section: 'built',
    when: q => !!q.walkthrough && !q.walkthrough.meta.evaluated,
    render: q => {
      const m = q.walkthrough.meta;
      return {
        text: `**{lang} has not been probed yet, so there is nothing here to report.** ` +
              `{scored} of {of} properties carry a verdict. This row exists to be filled ` +
              `by building and running the probes, never by reasoning about the language: ` +
              `until then the tool shows you an empty selection rather than a plausible ` +
              `one. Once the verdicts are recorded, everything the other modes do applies ` +
              `to {lang} unchanged — that is what the walkthrough is meant to demonstrate.`,
        slots: { lang: m.language, scored: m.scored, of: m.of },
        cites: [],
      };
    },
  },

  walkthroughScored: {
    severity: 'info',
    audience: 'advice', section: 'built',
    when: q => !!q.walkthrough && q.walkthrough.meta.evaluated,
    render: q => {
      const m = q.walkthrough.meta;
      return {
        text: `**This is {lang}, a language the study did not evaluate.** Its row was ` +
              `scored from outside the survey with the same framework and the same ` +
              `criteria, and is answered below by exactly the machinery that answers ` +
              `every other selection — nothing here was added for it. Read what follows ` +
              `as a position against the {total} evaluated languages, not as a verdict ` +
              `carrying their weight: one row scored by one team is one row.`,
        slots: { lang: m.language, total: q.match.total },
        cites: [],
      };
    },
  },

  /* ------------------------------------------- 1c. is this rare, or is it unbuilt
   * "Nobody has built this" and "three languages have built this" are different
   * answers and a practitioner acts on them differently. The extensional count is
   * already reported; this reads it.
   */

  rarity: {
    severity: 'note',
    audience: 'advice', section: 'built', rank: 15,
    when: q => !(q.sel && q.sel.language)
               && q.match.selected > 0 && q.match.n > 0 && q.match.n <= 5,
    render: q => ({
      text: `That is {n} of {total} — a combination almost nothing provides. If you need ` +
            `it, you are choosing between {those} {langword} and nothing else, and ` +
            `whatever else {they} {bring} comes with the choice.`,
      slots: {
        n: q.match.n, total: q.match.total,
        those: plural(q.match.n, 'that one', 'those'),
        langword: plural(q.match.n, 'language', 'languages'),
        they: plural(q.match.n, 'it', 'they'),
        bring: plural(q.match.n, 'brings', 'bring'),
      },
      cites: q.match.languages.map(l => `language:${l}`),
    }),
  },


  /* ------------------------------------------------- 2. is this a proven choice
   * The question every architect ends on — "so should I pick this?" — answered
   * the only way this corpus can answer it: by saying how well trodden the design
   * is, what it reliably gives, and what it reliably does not, each conditional
   * on a goal the reader supplies.
   *
   * It recommends nothing and prescribes nothing. "If you need authority control,
   * this design does not carry it" is a restatement of the counts above, not a
   * remedy — the study tested no remedy. Everything past that conditional is §6.
   */

  designAssessment: {
    severity: 'info',
    audience: 'advice', section: 'design', rank: 20,
    // "is this a proven choice" is a question about a design under consideration.
    // Asked of a language the reader already uses, the honest answer is the whole
    // rest of the page.
    when: q => !(q.sel && q.sel.language)
               && q.match.n > 0 && !!q.profile && q.profile.basis > 0
               && q.profile.properties.length > 0,
    render: (q, db) => {
      const share = q.match.n / q.match.total;
      const reliable = q.profile.properties.filter(r => r.share >= 90).slice(0, 4);
      const scarce = q.profile.properties.filter(r => r.share <= 25).slice(-4).reverse();
      const maturity = share >= 0.4
        ? 'a well-trodden design: a large share of the languages studied provide it'
        : (q.match.n >= 5
           ? 'a real but uncommon design: a handful of languages provide it'
           : 'close to unoccupied ground: almost nothing provides it');
      return {
        text: `**Is this a proven choice?** On the only measure this study can offer — ` +
              `how many languages have built it — {n} of {total} means {maturity}. ` +
              `{gives}{lacks}Which of those matters is your call: the study measured ` +
              `what these designs do, never what your system needs.`,
        slots: {
          n: q.match.n, total: q.match.total, maturity,
          gives: reliable.length
            ? `If what you want is ${list(names(db, reliable.map(r => r.property)))}, `
              + `this design carries ${plural(reliable.length, 'it', 'them')} reliably — `
              + `${plural(reliable.length, 'it is', 'they are')} present in at least `
              + `nine in ten of the languages that match. `
            : '',
          lacks: scarce.length
            ? `If what you want is ${list(names(db, scarce.map(r => r.property)))}, `
              + `this design does not carry ${plural(scarce.length, 'it', 'them')}: `
              + `${plural(scarce.length, 'it is', 'they are')} in a quarter of the `
              + `matching languages or fewer, so it would have to come from somewhere `
              + `other than the module system. `
            : '',
        },
        cites: [...reliable, ...scarce].map(r => `property:${r.property}`),
      };
    },
  },

  /* ---------------------------------------------- 2a. the answer, before the working
   * The family is the conclusion of this section, so it goes first and the
   * derivation follows. Putting the grouping argument first made a reader
   * assemble the answer themselves from three statements. */

  /* --------------------------------------------------------------- 6b. family
   * The family is a recorded fact for an evaluated language and a distribution
   * for a combination. Both are read out, never inferred: a selection that
   * matches several families is reported as matching several. */

  familyRecorded: {
    severity: 'info',
    audience: 'advice', section: 'design', rank: 10,
    when: q => !!q.family && !!q.family.recorded,
    render: q => {
      const f = q.family.recorded;
      return {
        // A recorded language SITS in a family the corpus assigned it. The
        // walkthrough row does not: it was never in the study, so its family is
        // computed by applying the same rule to its verdicts. Saying "recorded in"
        // of that row would claim a membership it does not have.
        text: `**{name}.** {defn} {placement}` +
              `{secondtail}{weaktail}`,
        slots: {
          name: f.primary, defn: f.definition,
          placement: f.placed_by
            ? 'This row was not part of the study, so that is where it LANDS when the '
              + 'same rule is applied to its verdicts, not a family it was recorded in'
            : 'That is the family this language is recorded in',
          aff: `${Math.round(f.affinity[f.primary] * 100)}%`,
          secondtail: f.secondary && f.secondary.length
            ? `, and it also sits within reach of ${list(f.secondary)}` : '',
          weaktail: f.weak_fit
            ? '. It is recorded as a weak fit: it matches no family closely, and the '
              + 'family label should be read as the nearest one rather than as a description.'
            : '.',
        },
        why: `The placement is computed, not assigned: this language's profile across `
             + `the property groups sits closer to that family's average than to any `
             + `other, by ${Math.round(f.affinity[f.primary] * 100)} against `
             + `${Object.entries(f.affinity).filter(x => x[0] !== f.primary)
                   .sort((a, b) => b[1] - a[1])
                   .map(x => `${Math.round(x[1] * 100)} for ${x[0]}`).join(', ')}, `
             + `on a scale where a hundred would mean an exact match. Leave-one-out `
             + `validation reproduces the placement of every language in the study.`,
        why_source: 'templated',
        cites: [`family:${f.primary}`, `language:${f.language}`],
      };
    },
  },

  familyDistribution: {
    severity: 'info',
    audience: 'advice', section: 'design', rank: 10,
    when: q => !!q.family && !!q.family.distribution && q.family.distribution.length > 0,
    render: q => {
      const d = q.family.distribution;
      // the family the selection lands in most, and WHY that family is what it is:
      // its centroid over the three property packages, which is the definition
      const lead = [...d].sort((a, b) => b.n - a.n || b.n / b.size - a.n / a.size)[0];
      // "checked 0.92, parametric 0.23, sandbox 0.217" is three unexplained words
      // and three bare decimals. Each score is the share of that group of
      // properties its members hold, so it is said as a share, with the group's
      // size, and rounded to the precision the measure actually has.
      const SIZE = lead.groups || {};
      const DEF = q.group_definitions || {};
      const prof = Object.entries(lead.centroid)
        .sort((a, b) => b[1] - a[1])
        .map(([g, v], i) => {
          const n = (SIZE[g] || []).length;
          const pct = Math.round(v * 100);
          // the leading group carries its definition; glossing all three would
          // bury the figures the sentence exists to give
          const gloss = i === 0 && DEF[g] ? `, where ${DEF[g]}` : '';
          return `${pct}% of the ${g.toLowerCase()} group`
               + (n ? ` (${n} ${plural(n, 'property', 'properties')}${gloss})` : gloss);
        });
      const rest = d.filter(x => x !== lead).map(x => `${x.family} (${x.n})`);
      const members = (q.family.members || {})[lead.family] || [];
      const mine = members.filter(l => q.match.languages.includes(l));
      return {
        // the answer, what it means, and who is in it. The arithmetic that
        // produced the label is real and checkable and belongs in `why`, where a
        // reader who wants it can open it — not in front of one who wants to know
        // what kind of thing they are building.
        text: `**{lead}.** That is the design style most of your selection belongs to: ` +
              `{n} of the {tot} matching {langword} are in it{share}. {defn} {tail}`,
        table: mine.length
          ? { columns: ['in this family, and matching', 'of the family'],
              rows: [[list(mine), `${members.length} in all`]] }
          : null,
        why: `The label is computed, not assigned. A family is defined by how much of `
             + `each group of properties its members hold, counting a partial verdict as `
             + `half; this one averages ${list(prof)}. Leave-one-out validation reproduces `
             + `the placement of every language in the study.`,
        why_source: 'templated',
        slots: {
          lead: lead.family, n: lead.n, tot: q.match.n,
          langword: plural(q.match.n, 'language', 'languages'),
          share: lead.n === lead.size
            ? `, which is every language in it`
            : `, out of ${lead.size} in the family`,
          defn: lead.definition || '',
          prof: list(prof),
          tail: rest.length
            ? `The rest are spread across ${list(rest)} — so your requirement is met by `
              + `more than one recognised design, not just this one.`
            : `Nothing outside that family satisfies your selection, so this is a `
              + `coherent design rather than a coincidence.`,
        },
        cites: [`family:${lead.family}`,
                ...Object.keys(lead.centroid).map(g => `property_group:${g}`),
                ...q.match.languages.map(l => `language:${l}`)],
      };
    },
  },

  /* --------------------------------------------- 2b. why these belong together
   * A practitioner picking several properties is entitled to know whether they
   * are asking for one thing or several. The property groups answer it: they were
   * derived from what languages provide together, so a selection inside one group
   * is a single design decision and a selection spanning groups is several.
   */

  coherence: {
    severity: 'info',
    audience: 'advice', section: 'design', rank: 30,
    // same reason: "you are asking for three separate things" is addressed to
    // someone who chose, and a lookup chose a language, not a set of properties
    when: q => !(q.sel && q.sel.language)
               && (q.groups_touched || []).length > 0 && q.match.selected > 1,
    render: (q, db) => {
      const gs = q.groups_touched;
      const one = gs.length === 1;
      const DEF = q.group_definitions || {};
      // the group's definition rather than its internal name: "checked" opening a
      // sentence tells a reader nothing they can use
      const inside = gs.map(g =>
        `${list(names(db, g.selected))} — ${DEF[g.id] || g.id.toLowerCase()}`);
      return {
        text: one
          ? `**These are one design decision, not several.** You picked {inside}. They ` +
            `sit in one group because languages that provide any of them tend to ` +
            `provide the rest — the grouping comes from what the corpus records ` +
            `co-occurring, not from the words sounding alike.`
          : `**You are asking for {n} separate things, not one.** Your selection spans ` +
            `{inside}. Each group is a decision a language makes on its own, and ` +
            `spanning them is what makes a combination hard to find.`,
        slots: {
          n: gs.length,
          inside: one ? inside[0] : clauses(inside),
        },
        cites: gs.map(g => `property_group:${g.id}`),
      };
    },
  },


  /* ------------------------------------------------------------ 2. entailment */


  /* ------------------------------------------------------------- 3. exclusion */


  /* ----------------------------------------------- 1e. what kind of boundary it is
   * Enforced or left to discipline; the unit it applies to; the stage the
   * violation is refused at. All three are on every cell and none was ever said.
   * The unit is the one practitioners are most often wrong about — `private`
   * means per-declaration in one language and per-module in the next, and the
   * keyword looks identical either way.
   */

  boundaryNature: {
    severity: 'info',
    audience: 'advice', section: 'design', rank: 40,
    when: q => !!q.nature && q.nature.properties.length > 0,
    render: (q, db) => {
      // a table, and all of them: four in prose left fourteen unsaid, and these
      // are three short facts per row that a reader wants to compare down a column
      const top = xs => (xs.length ? xs[0] : null);
      // A vocabulary translation, on the same footing as pluralisation: the
      // corpus records `mechanical`, and a reader asks what does the enforcing.
      // The recorded value is unchanged and still shown in the evidence panel.
      const ENFORCER = {
        mechanical: 'the toolchain', conventional: 'convention only',
        mixed: 'the toolchain, partly', none: 'not enforced',
      };
      // the corpus stores a phase as one word; appending " time" to it produced
      // "runtime time", which reads as a generation fault and was one
      const PHASE = {
        compile: 'compile time', runtime: 'run time', load: 'load time',
        link: 'link time', dispatch: 'dispatch', artefact: 'the built artefact',
        none: 'never — it is not refused',
      };
      const cell = (r, field, map) => {
        const t = top(r[field]);
        if (!t) return '—';
        const v = map ? (map[t.value] || t.value) : t.value;
        return t.n === r.basis ? v : `${v} in ${t.n} of ${r.basis}`;
      };
      return {
        text: `**How these boundaries are actually enforced, and over what unit.** ` +
              `The unit is the part most often assumed rather than checked — the same ` +
              `keyword applies per declaration in one language and across a whole ` +
              `module in the next, and that is what decides whether code sitting ` +
              `beside yours can reach in.`,
        table: {
          columns: ['property', 'enforced by', 'scope', 'rejected at'],
          rows: q.nature.properties.map(r => [
            names(db, [r.property])[0],
            cell(r, 'enforcement', ENFORCER),
            cell(r, 'granularity', null),
            cell(r, 'phase', PHASE),
          ]),
        },
        slots: {},
        cites: q.nature.properties.map(r => `property:${r.property}`),
      };
    },
  },

  /* ------------------------------------------- 2. what comes with it, graded
   * `entails` and `excludes` asked the logical question — does this ever occur
   * without X — and fired only at the extremes. These ask the practitioner's
   * question: of the languages that give you what you asked for, how many give
   * you this as well. The middle of that range is where the useful answers are,
   * and the all-or-nothing form threw it away.
   */

  comesWith: {
    severity: 'note',
    audience: 'advice', section: 'with', rank: 10,
    when: q => !!q.profile && q.profile.basis > 0
               && q.profile.properties.some(r => r.share >= 75),
    render: (q, db) => {
      const rows = q.profile.properties.filter(r => r.share >= 75).slice(0, 7);
      const all = rows.filter(r => r.present === q.profile.basis);
      const fmt = r => `${names(db, [r.property])[0]} — ${r.present} of ${q.profile.basis}` +
        (r.full < r.present ? `, fully in ${r.full}` : '');
      // "You asked for 3" left the reader to work out three of what. Name them
      // when the list is short enough to read, and count them when it is not.
      const asked = Object.keys(q.sel.props || {}).sort();
      const named = asked.length <= 4
        ? list(names(db, asked))
        : `the ${asked.length} properties you selected`;
      return {
        text: `**Choose {asked}, and you are choosing {n} more {propword} with {these}.** ` +
              `{invariant}These are so strongly associated that they are better read as ` +
              `part of one design choice than as separate decisions you could take or ` +
              `leave.`,
        table: {
          columns: ['property', 'languages that have it', 'of those, fully'],
          rows: rows.map(r => [names(db, [r.property])[0], `${r.present} of ${q.profile.basis}`,
                               String(r.full)]),
        },
        slots: {
          asked: named,
          them: plural(asked.length, 'it', 'all of them'),
          n: rows.length,
          propword: plural(rows.length, 'property', 'properties'),
          rows: clauses(rows.map(fmt)),
          // the subject and its verb are built together; an earlier version fixed
          // the verb in the template and rendered "The first 6 holds"
          invariant: all.length
            ? (all.length === rows.length
                ? 'Every one of those is present in all of them, not merely most. '
                : `The first ${all.length} `
                  + `${plural(all.length, 'is', 'are')} present in every one of them, `
                  + `not merely most. `)
            : '',
          these: plural(rows.length, 'it', 'them'),
        },
        cites: rows.map(r => `property:${r.property}`),
      };
    },
  },

  unlikely: {
    severity: 'note',
    audience: 'advice', section: 'without',
    when: q => !!q.profile && q.profile.basis > 0
               && q.profile.properties.some(r => r.share <= 35),
    render: (q, db) => {
      const rows = q.profile.properties.filter(r => r.share <= 35).slice(-6).reverse();
      const none = rows.filter(r => r.present === 0);
      const fmt = r => r.present === 0
        ? `${names(db, [r.property])[0]} — none of them`
        : `${names(db, [r.property])[0]} — ${r.present} of ${q.profile.basis}`;
      return {
        text: `**What this design almost never comes with.** {nothing}If you need any of ` +
              `{these} as well, expect a much smaller field than the one above — or to ` +
              `be building it outside the language.`,
        table: {
          columns: ['property', 'languages that have it'],
          rows: rows.map(r => [names(db, [r.property])[0],
                               r.present === 0 ? 'none of them'
                                               : `${r.present} of ${q.profile.basis}`]),
        },
        slots: {
          rows: clauses(rows.map(fmt)),
          nothing: none.length
            ? `${none.length === 1 ? 'The one marked "none of them" is' : 'Those marked '
               + '"none of them" are'} not a matter of rarity: no language meeting your `
              + `requirement provides ${plural(none.length, 'it', 'them')} at all. `
            : '',
          these: plural(rows.length, 'it', 'them'),
        },
        cites: rows.map(r => `property:${r.property}`),
      };
    },
  },

  /* ------------------------------------------- 1d. what to read the source of
   * Which of the matching languages are representative and which are the odd
   * ones out, by agreement with the group's own modal design across every
   * property. The answer to "what should I study as a reference implementation".
   */

  referenceImplementations: {
    severity: 'info',
    audience: 'advice', section: 'study',
    when: q => !!q.typicality && q.typicality.languages.length >= 4,
    render: q => {
      const ls = q.typicality.languages;
      const top = ls.slice(0, 3);
      const odd = ls.slice(-2).filter(x => x.agrees < top[0].agrees);
      return {
        text: `**To see this design done the usual way, read {top}.** {topword} the ` +
              `answer most of this group gives on {a} of {of} properties, so {they} show ` +
              `the shape of the design rather than one team's take on it.{oddtail}`,
        slots: {
          top: list(top.map(x => x.language)),
          topword: plural(top.length, 'It gives', 'They give'),
          a: top[0].agrees, of: top[0].of,
          they: plural(top.length, 'it', 'they'),
          oddtail: odd.length
            ? ` For a different take on the same requirement, read `
              + `${list(odd.map(x => x.language))}: ${plural(odd.length, 'it agrees', 'they agree')} `
              + `with the group on only ${list([...new Set(odd.map(x => String(x.agrees)))])} `
              + `of them, so ${plural(odd.length, 'it reaches', 'they reach')} the same place `
              + `by a route the others do not take.`
            : '',
        },
        cites: ls.map(x => `language:${x.language}`),
      };
    },
  },

  /* ------------------------------------------------- 5b. no boundary at all
   * The corpus records the naive violation separately from the bypass routes, and
   * the distinction is the most practical one in the whole dataset: a bypassable
   * boundary is one an attacker has to know a trick to cross; an unconfined one is
   * not a boundary. A reader who learns their boundary falls to reflection writes
   * a lint rule. A reader who learns the plain violation was accepted has nothing
   * to harden — they have a convention.
   */

  unconfined: {
    severity: 'error',
    audience: 'advice', section: 'gives', rank: 10,
    when: q => (q.unconfined || []).length > 0,
    render: (q, db) => {
      const u = q.unconfined;
      const rows = u.slice(0, 8).map(x =>
        `${x.language} — ${names(db, [x.property])[0]}, recorded ${x.support}`
        + (x.partial_route && x.partial_route !== 'n/a' ? ` via ${x.partial_route}` : ''));
      const atFull = u.filter(x => x.support === 'full');
      return {
        text: `**No bypass was needed here: the obvious violation was simply accepted.** ` +
              `{n} of the language-and-property pairs you selected {record} the ` +
              `property as present while the straightforward breach compiles and runs — ` +
              `{rows}{tail}.{full}{partial} This is a different finding from the ones ` +
              `below. A ` +
              `boundary that gives way to a named construct can be restricted; one that ` +
              `was never enforced cannot, because there is nothing there to restrict.`,
        slots: {
          n: u.length,
          record: plural(u.length, 'records', 'record'),
          rows: clauses(rows),
          tail: u.length > rows.length
            ? `, and ${u.length - rows.length} more` : '',
          full: atFull.length
            ? ` ${atFull.length} of ${plural(atFull.length, 'them is', 'them are')} recorded `
              + `at the strongest verdict the study awards.`
            : '',
          // a partial verdict beside an accepted violation looks like a
          // contradiction until you say which part was not enforced, and the
          // corpus records that as the partial route
          partial: u.some(x => x.support === 'partial')
            ? ` A partial verdict means the property holds in some respect and not in `
              + `the one the violation probe exercised — the route named beside each is `
              + `the part the study found unenforced, so no bypass was required to cross `
              + `it.`
            : '',
        },
        cites: u.map(x => `cell:${x.language}/${x.property}`),
      };
    },
  },

  /* -------------------------------------------------------- 4. counterfactual */

  binding: {
    severity: 'note',
    audience: 'advice', section: 'rare', rank: 10,
    when: q => q.match.selected > 1 && q.counterfactual.dropped.length > 0
               && q.counterfactual.dropped[0].gain > 0,
    render: (q, db) => {
      const d = q.counterfactual.dropped[0];
      return {
        text: `**{prop} is the most restrictive thing you asked for.** Drop it and ` +
              `{n} {langword} would match instead of {base} — more than any other ` +
              `requirement in your selection changes it. If the field is too narrow, ` +
              `that is the one to revisit first.`,
        slots: {
          prop: names(db, [d.property])[0], n: d.without,
          langword: plural(d.without, 'language', 'languages'), base: q.counterfactual.base,
        },
        cites: [`property:${d.property}`],
      };
    },
  },

  /* --------------------------------------------------------- 5. nearest miss */

  nearestMiss: {
    severity: 'note',
    audience: 'advice', section: 'study',
    when: q => q.match.n === 0 && q.nearestMiss.languages.length > 0,
    render: (q, db) => {
      const d = q.nearestMiss.distance;
      // Name each near language's FAMILY as well as what it misses. Without it a
      // reader is told nothing matches and which languages come closest, but not
      // what kind of design those languages are -- which is the question the
      // distance was being asked in order to answer.
      const famOf = {};
      for (const lf of (q.families_index || [])) famOf[lf.language] = lf.primary;
      const rows = q.nearestMiss.languages.map(x =>
        `${x.language}${famOf[x.language] ? ` — ${famOf[x.language]}` : ''}`
        + ` (${x.missing.map(m => `${m.property} is ${m.actual}, not ${m.wanted}`).join('; ')})`);
      const total = q.nearestMiss.total;
      const shown = q.nearestMiss.languages.length;
      const more = total - shown;
      return {
        text: `{n} {langword} {miss} on {d} {propword}, the fewest of any: {rows}{tail}.`,
        slots: {
          n: total,
          langword: plural(total, 'language', 'languages'),
          miss: plural(total, 'misses', 'miss'),
          d, propword: plural(d, 'property', 'properties'), rows: clauses(rows),
          tail: more > 0 ? `; and ${more} ${plural(more, 'other', 'others')}` : '',
        },
        display: { total, shown, more },
        cites: q.nearestMiss.languages.flatMap(x =>
          x.missing.map(m => `cell:${x.language}/${m.property}`)),
      };
    },
  },

  /* -------------------------------------------------------------- 6. exposure */

  exposureDefeated: {
    severity: 'warn',
    audience: 'advice', section: 'gives', rank: 20,
    when: q => q.exposure.counts.universal.defeated > 0
               || q.exposure.counts.extended.defeated > 0,
    render: q => {
      const c = q.exposure.counts;
      // name only the axes that carry records, so a selection touching one axis
      // does not report an empty denominator on the other
      // The two axes have different denominators and §4.3.2 keeps them apart for
      // good reason, but "the uniform six-route axis" is the study's vocabulary,
      // not the reader's. The total is what they need; the split is in the
      // evidence, and the reason for it is a method note.
      const att = c.universal_n + c.extended_n;
      const def = c.universal.defeated + c.extended.defeated;
      return {
        text: `**These boundaries were broken in testing.** Of {att} attempts against ` +
              `the properties you selected, in the languages that have them, {def} ` +
              `succeeded. Counted per boundary rather than per attempt — one boundary ` +
              `can fall several ways — {cd} of the language-and-property pairs here ` +
              `{cdword} broken at least once.`,
        slots: {
          att, def,
          cd: c.cells.defeated,
          cdword: plural(c.cells.defeated, 'is', 'are'),
        },
        cites: q.exposure.records.filter(r => r.outcome === 'defeated').map(r => `route:${r.id}`),
      };
    },
  },

  /* ------------------------------------------- 6a. tried, and nothing succeeded
   * There was no statement for the case where routes WERE attempted and none of
   * them worked. `exposureDefeated` needs a defeat and `exposureNone` needs an
   * empty record set, so a selection that was attacked and held said nothing at
   * all about the outcome — the reader met a route table with no verdict on it.
   *
   * It leads with the result and then takes it back down to what it is worth,
   * because "nothing succeeded" over a handful of attempts is a weak claim and
   * reads as a strong one.
   */

  exposureHeld: {
    severity: 'info',
    audience: 'advice', section: 'gives', rank: 15,
    when: q => q.exposure.records.length > 0
               && q.exposure.counts.universal.defeated === 0
               && q.exposure.counts.extended.defeated === 0,
    render: q => {
      const n = q.exposure.records.length;
      const cells = new Set(q.exposure.records.map(r => r.language + '/' + r.property)).size;
      return {
        text: `**Nothing succeeded here.** {allword} recorded {attword} against the ` +
              `properties you selected failed. That is a real result and a narrow one: ` +
              `it covers {cells} language-and-property {pairword}, and it says the ` +
              `routes that were tried did not work — not that the boundary cannot be ` +
              `crossed. {tail}`,
        slots: {
          n, attword: plural(n, 'attempt', 'attempts'),
          allword: n === 1 ? 'The one' : `All ${n}`,
          cells, pairword: plural(cells, 'pair', 'pairs'),
          tail: n < 5
            ? 'On this few attempts the evidence is not enough to conclude that the '
              + 'boundary holds, only that it was not broken by what was tried.'
            : 'Routes the study did not attempt here are listed under coverage below.',
        },
        cites: q.exposure.records.map(r => `route:${r.id}`),
      };
    },
  },

  exposureFacilities: {
    severity: 'warn',
    audience: 'advice', section: 'gives', rank: 70,
    when: q => q.exposure.facilities.length > 0,
    render: q => {
      const facs = q.exposure.facilities;
      const SHOW = 4;
      const named = facs.slice(0, SHOW).map(f => f.facility);
      const rest = facs.length - named.length;
      // mechanism is the level at which unrelated languages coincide, so the
      // grouping is the more useful summary of a long facility list
      const mech = new Map();
      for (const f of facs) mech.set(f.mechanism, (mech.get(f.mechanism) || 0) + f.n);
      const byMech = [...mech.entries()].sort((a, b) => b[1] - a[1])
                       .map(([m, n]) => `${m} (${n})`);
      return {
        text: `**It took ordinary code, not an exploit.** {n} different {facword} did ` +
              `it — {named}{tail} — and {they} {reduce} to {m} {mechword}. Every one is ` +
              `a documented feature of its language that any developer can call, which ` +
              `is why a code review looking for an attack will not find {them}.`,
        table: {
          columns: ['mechanism', 'facilities'],
          rows: byMech.map(x => {
            const i = x.lastIndexOf(' (');
            return [x.slice(0, i), x.slice(i + 2, -1)];
          }),
        },
        slots: {
          n: facs.length, facword: plural(facs.length, 'facility', 'facilities'),
          they: plural(facs.length, 'it', 'they'),
          reduce: plural(facs.length, 'reduces', 'reduce'),
          m: mech.size, mechword: plural(mech.size, 'mechanism', 'mechanisms'),
          mechs: list(byMech),
          facwordNamed: plural(named.length, 'facility', 'facilities'),
          named: list(named),
          them: plural(facs.length, 'it', 'them'),
          tail: rest > 0 ? `, and ${rest} ${plural(rest, 'other', 'others')}` : '',
        },
        display: { total: facs.length, shown: named.length, more: rest },
        cites: facs.flatMap(f => f.records.map(r => `route:${r}`)),
      };
    },
  },

  /* ------------------------------------------------------- 6bb. how stable that is
   * Step 9 held each evaluated language out of the corpus and rebuilt the
   * instrument from the rest. A language whose family does not come back is one
   * the taxonomy leans on, and the tool says so where the language is read out
   * rather than leaving it in a data file. */

  validationStability: {
    severity: 'note',
    audience: 'method', section: 'method',
    when: q => !!q.validation,
    render: q => {
      const v = q.validation;
      const unplaceable = v.family_predicted === null;
      return {
        text: unplaceable
          ? `Held out of the corpus, this language cannot be classified at all: the ` +
            `property grouping the family rule depends on does not survive its removal. ` +
            `The family it is recorded in rests on it, so read the label as a description ` +
            `of a group this language helps define rather than one it was sorted into.`
          : (v.family_stable
             ? `Held out of the corpus and classified from the rest, it comes back to the ` +
               `same family, and the remaining languages predict {hits} of {tested} of its ` +
               `recorded bypass outcomes.`
             : `Held out of the corpus and classified from the rest, it lands in {pred} ` +
               `rather than the family it is recorded in. The boundary between the two ` +
               `runs through it.`),
        slots: {
          hits: v.exposure_hits, tested: v.exposure_tested,
          pred: v.family_predicted,
        },
        cites: (v.evidence && v.evidence.cells ? v.evidence.cells : []).map(c => `cell:${c}`),
      };
    },
  },

  /* ----------------------------------------- 6bc. what validation says about this
   * Step 9 tested the instrument against its own corpus and two of the three
   * results were negative. Both are reported where they bear on what the user is
   * looking at, not only in a data file:
   *
   *   - one property group does not survive leave-one-out, so a selection drawn
   *     from it is resting on a structure four languages hold up;
   *   - reasoning from support profile does not predict what happens under
   *     attack, so an exposure block must not be read as a forecast.
   */

  validationFragileAxis: {
    severity: 'note',
    audience: 'method', section: 'method',
    when: q => (q.fragile_groups || []).length > 0,
    render: (q, db) => {
      const g = q.fragile_groups[0];
      return {
        text: `A note on {props}, which you selected together: the study groups {those} as ` +
              `one axis because they answer one design question, and reports that grouping ` +
              `as declared rather than found. They hold together across only {n} ` +
              `{langword} — {langs} — and removing any of {them} dissolves the grouping. ` +
              `The individual verdicts are unaffected. What the corpus supports weakly is ` +
              `the claim that these belong together, and that weakness has the same cause ` +
              `as the exposure you are looking at: almost nothing implements them together.`,
        slots: {
          props: list(names(db, g.properties)),
          those: plural(g.properties.length, 'it', 'them'),
          langs: list(g.depends_on),
          n: g.depends_on.length,
          langword: plural(g.depends_on.length, 'language', 'languages'),
          them: plural(g.depends_on.length, 'it', 'them'),
        },
        cites: [`property_group:${g.id}`, ...g.depends_on.map(l => `language:${l}`)],
      };
    },
  },

  validationNotPrediction: {
    severity: 'note',
    audience: 'method', section: 'method',
    when: q => !!q.validation_summary && q.exposure.records.length > 0,
    render: q => {
      const v = q.validation_summary;
      return {
        text: `**This is a record, not a forecast.** What happened to these languages ` +
              `is not evidence for what will happen to your code: we tested that, and ` +
              `guessing from a similar property profile was right {hits} times out of ` +
              `{tested} — worse than assuming everything falls, which scores {base}. ` +
              `Where it was wrong it cried wolf: {fd} of the misses predicted a break ` +
              `that never happened.`,
        slots: {
          hits: v.exposure_hits, tested: v.exposure_tested, base: v.baseline_hits,
          fd: v.false_defeat, fr: v.false_resist,
        },
        cites: ['validation:summary'],
      };
    },
  },

  /* ------------------------------------------------------------- 6c. known gap
   * A selection landing on one of the recorded design-space gaps gets the
   * section's own sentence about it, quoted rather than regenerated. */

  gapMatch: {
    severity: 'warn',
    audience: 'advice', section: 'rare', rank: 20,
    when: q => !!q.gaps && q.gaps.length > 0,
    render: (q, db) => {
      const g = q.gaps[0];
      return {
        text: `This selection lands on a recorded gap in the design space — {blurb} ` +
              `{quote}`,
        slots: { blurb: g.blurb, quote: g.why },
        cites: [`gap:${g.id}`],
      };
    },
  },

  /* ------------------------------------------------- 7. the bypass-route axis
   * The second input dimension. A team states which routes their design ships
   * and these four report what that decision does and does not buy. The third
   * is the one that changes behaviour: a restriction narrows exposure without
   * ending it, and the corpus can say by how much because it attempted the
   * other routes too.
   */

  routeAxisAll: {
    severity: 'warn',
    audience: 'advice', section: 'gives', rank: 30,
    when: q => !q.exposure.other_routes && q.exposure.selected_routes.length > 0,
    render: (q, db) => {
      // The per-route breakdown is the most actionable measurement on the page
      // and it was buried in the method box. It is ranked by how often the route
      // succeeded, and the routes that account for most of the damage are named
      // in a sentence rather than left for the reader to add up.
      const rs = [...q.exposure.selected_routes]
        .filter(r => r.attempts > 0)
        .sort((a, b) => b.defeated - a.defeated || b.attempts - a.attempts);
      const totalDef = rs.reduce((a, r) => a + r.defeated, 0);
      const rows = rs.map(r =>
        `${r.route} ${r.defeated} of ${r.attempts}`);
      // the shortest run of routes covering most of what succeeded
      const lead = [];
      let got = 0;
      for (const r of rs) {
        if (got / (totalDef || 1) >= 0.7) break;
        lead.push(r); got += r.defeated;
      }
      return {
        text: `**{takeaway}**`,
        table: {
          columns: ['route', 'attempts', 'broke through', 'held'],
          rows: rs.map(r => [r.route, String(r.attempts),
                             String(r.defeated), String(r.resisted)]),
        },
        slots: {
          rows: clauses(rows),
          takeaway: lead.length && lead.length < rs.length
            ? `Most of the breakage came through ${list(lead.map(r => r.route))} — `
              + `${got} of the ${totalDef} successful crossings between `
              + `${plural(lead.length, 'it', 'them')}. A language can check its module `
              + `boundary thoroughly at compile time and still lose it to a facility `
              + `like these: it was not the module system that gave way.`
            : `No single route dominates here, so there is no one facility whose `
              + `absence would have changed the picture.`,
        },
        cites: rs.flatMap(r => r.records.map(i => `route:${i}`)),
      };
    },
  },

  routeAxisSelected: {
    severity: 'warn',
    audience: 'advice', section: 'gives', rank: 30,
    when: q => !!q.exposure.other_routes && q.exposure.selected_routes.length > 0,
    render: (q, db) => {
      const rs = [...q.exposure.selected_routes]
        .sort((a, b) => b.defeated - a.defeated || b.attempts - a.attempts);
      const broke = rs.filter(r => r.defeated > 0);
      return {
        text: `**Of the facilities shipped here, {n} {word} tried against these ` +
              `properties{brokeword}.**`,
        table: {
          columns: ['route', 'attempts', 'broke through', 'held'],
          rows: rs.map(r => [r.route, String(r.attempts),
                             String(r.defeated), String(r.resisted)]),
        },
        slots: {
          n: rs.length,
          word: plural(rs.length, 'route was', 'routes were'),
          brokeword: broke.length
            ? `, and ${broke.length} of them got through`
            : ', and none of them got through',
        },
        cites: q.exposure.selected_routes.flatMap(r => r.records.map(i => `route:${i}`)),
      };
    },
  },

  collateralFacility: {
    severity: 'warn',
    audience: 'advice', section: 'gives', rank: 50,
    when: q => q.exposure.collateral.length > 0,
    render: (q, db) => {
      const SHOW = 5;
      const shown = q.exposure.collateral.slice(0, SHOW);
      const rest = q.exposure.collateral.length - shown.length;
      const rows = shown.map(c =>
        `in ${c.language}, “${c.facility}” reaches ${list(names(db, c.properties))}`);
      return {
        text: `Choosing a route is not a per-property decision. {n} {word} here {defeat} ` +
              `more than one of the properties you selected, in the same language and by ` +
              `the same construct: {rows}{tail}. Hardening one of the properties a single ` +
              `facility reaches hardens none of them, because the facility is unchanged.`,
        slots: {
          n: q.exposure.collateral.length,
          word: plural(q.exposure.collateral.length, 'facility', 'facilities'),
          defeat: plural(q.exposure.collateral.length, 'defeats', 'defeat'),
          rows: clauses(rows),
          tail: rest > 0 ? `; and ${rest} ${plural(rest, 'other', 'others')}` : '',
        },
        display: { total: q.exposure.collateral.length, shown: shown.length, more: rest },
        cites: q.exposure.collateral.flatMap(c => c.records.map(i => `route:${i}`)),
      };
    },
  },

  routeRestrictionLeaks: {
    severity: 'warn',
    audience: 'advice', section: 'gives', rank: 60,
    // Only the excluded routes that actually defeat something are worth naming.
    // `other_routes` itself is unfiltered, so the shipped and excluded sets still
    // partition the reachable records exactly; the filtering is presentation.
    // not in a lookup: there the unticked routes are the ones the language does
    // not ship, and calling them "routes you did not select" addresses a choice
    // the reader never made
    when: q => !(q.sel && q.sel.language)
               && q.exposure.other_routes
               && q.exposure.other_routes.some(r => r.defeated > 0),
    render: (q, db) => {
      const SHOW = 6;
      const leaks = q.exposure.other_routes.filter(r => r.defeated > 0);
      const shown = leaks.slice(0, SHOW);
      const rest = leaks.length - shown.length;
      const rows = shown.map(r =>
        `${r.route} (${r.defeated} ${plural(r.defeated, 'defeat', 'defeats')})`);
      return {
        text: `Restricting a route removes only what that route reaches. The corpus ` +
              `defeats the same properties in the same languages through {n} further ` +
              `{word} you did not select: {rows}{tail}. The restriction narrows your ` +
              `exposure; on this evidence it does not end it.`,
        slots: {
          n: leaks.length,
          word: plural(leaks.length, 'route', 'routes'),
          rows: list(rows),
          tail: rest > 0 ? `, and ${rest} ${plural(rest, 'other', 'others')}` : '',
        },
        display: { total: leaks.length, shown: shown.length, more: rest },
        cites: leaks.flatMap(r => r.records.map(i => `route:${i}`)),
      };
    },
  },

  routeNotAttempted: {
    severity: 'info',
    audience: 'method', section: 'method',
    when: q => q.exposure.routes_not_attempted.length > 0,
    render: q => ({
      text: `{n} {word} you named {was} never attempted against these properties in ` +
            `these languages: {which}. The corpus says nothing about {them} here — not ` +
            `that {they} {succeed}, and not that {they} {fail}.`,
      slots: {
        n: q.exposure.routes_not_attempted.length,
        word: plural(q.exposure.routes_not_attempted.length, 'route', 'routes'),
        was: plural(q.exposure.routes_not_attempted.length, 'was', 'were'),
        which: list(q.exposure.routes_not_attempted),
        them: plural(q.exposure.routes_not_attempted.length, 'it', 'them'),
        they: plural(q.exposure.routes_not_attempted.length, 'it', 'they'),
        succeed: plural(q.exposure.routes_not_attempted.length, 'succeeds', 'succeed'),
        fail: plural(q.exposure.routes_not_attempted.length, 'fails', 'fail'),
      },
      cites: [],
    }),
  },

  /* ------------------------------------------- 6d. what has ever stopped this
   * The nearest thing to advice the corpus can support, and the reason it is
   * worth having: it corrects the obvious advice rather than restating it. A
   * generic "restrict these facilities" list treats every route alike. The
   * evidence does not — some routes have well-attested designs that keep the
   * facility and hold the line, and others were only ever stopped by the facility
   * not existing.
   *
   * This states what was observed and stops there. Whether to restrict, redesign
   * or accept is the reader's decision and §6's subject: nothing here was tested
   * against a scanner, a sandbox or a build policy.
   */

  containment: {
    severity: 'note',
    audience: 'advice', section: 'gives', rank: 40,
    when: q => (q.containment || []).some(c => c.contained > 0 || c.held > 0),
    render: q => {
      const cs = q.containment;
      const tamed = cs.filter(c => c.contained > 0).slice(0, 4);
      const never = cs.filter(c => c.contained === 0 && c.fell > 0);
      return {
        text: `**Designs that held these routes elsewhere in the study.** ` +
              `{tamedtail}{nevertail}This is corpus-wide evidence, not evidence about ` +
              `the languages above, and the study tested no policy, scanner or ` +
              `sandbox — only what these languages already do.`,
        table: tamed.length
          ? { columns: ['route', 'held by a check, facility still present', 'by'],
              rows: tamed.map(c => [
                c.route,
                `${c.contained} ${plural(c.contained, 'time', 'times')}`,
                list(c.mechanisms.slice(0, 2).map(m => m.mechanism)),
              ]) }
          : null,
        slots: {
          tamedtail: tamed.length
            ? `These were contained without removing anything — the facility stayed and `
              + `the boundary held, which makes them designs rather than mitigations. `
            : '',
          nevertail: never.length
            ? `${list(never.map(c => c.route))} ${plural(never.length, 'was', 'were')} `
              + `never once held while present: across the whole corpus the only thing `
              + `that stopped ${plural(never.length, 'it', 'them')} was the facility not `
              + `being there. If your design ships ${plural(never.length, 'it', 'them')}, `
              + `the study has no example of ${plural(never.length, 'it', 'them')} being `
              + `contained. `
            : '',
        },
        cites: cs.flatMap(c => c.records.map(r => `route:${r}`)),
      };
    },
  },

  exposureResisted: {
    severity: 'info',
    audience: 'advice', section: 'gives', rank: 80,
    when: q => q.exposure.counts.universal.resisted > 0
               || q.exposure.counts.extended.resisted > 0,
    render: q => ({
      text: `{n} {attword} repelled — the boundary held. Treat that as "not broken by ` +
            `what we tried", not as "cannot be broken": a boundary that resists the ` +
            `routes we attempted may still fall to one we did not.`,
      slots: {
        n: q.exposure.counts.universal.resisted + q.exposure.counts.extended.resisted,
        attword: plural(q.exposure.counts.universal.resisted +
                        q.exposure.counts.extended.resisted, 'attempt was', 'attempts were'),
      },
      cites: q.exposure.records.filter(r => r.outcome === 'resisted').map(r => `route:${r.id}`),
    }),
  },

  exposureNone: {
    severity: 'info',
    audience: 'advice', section: 'gives', rank: 90,
    when: q => q.match.n > 0 && q.exposure.records.length === 0,
    render: q => ({
      text: `Nothing was attacked here. These boundaries were never tested, so this is ` +
            `an absence of evidence and not evidence of safety — do not read the empty ` +
            `result as a clean bill of health.`,
      slots: {},
      cites: [],
    }),
  },

  exposureUnlocated: {
    severity: 'info',
    audience: 'method', section: 'method',
    when: q => q.exposure.unlocated.length > 0,
    render: q => {
      const u = q.exposure.unlocated;
      const axes = [...new Set(u.map(x => x.route_class))];
      const routes = [...new Set(u.map(x => x.route))].sort();
      return {
        text: `{n} of the {word} reported here {carry} no recorded location for the ` +
              `facility that did it — the construct is named, but not the file and line ` +
              `it was found at. {axisword}: {routes}. {eachword} recorded as {status}, ` +
              `so the citation is pending rather than absent: the run happened and the ` +
              `adjudication that would cite it has not. Read {those} as weaker evidence ` +
              `than the rest.`,
        slots: {
          n: u.length,
          word: plural(u.length, 'defeat', 'defeats'),
          carry: plural(u.length, 'carries', 'carry'),
          axisword: axes.length === 1 && axes[0] === 'extended'
            ? 'Every one is on the wider per-language axis'
            : 'The routes affected',
          routes: list(routes),
          eachword: plural(u.length, 'It is', 'Each is'),
          status: list([...new Set(u.map(x => x.outcome_source))].sort()),
          those: plural(u.length, 'it', 'them'),
        },
        cites: u.map(x => `route:${x.id}`),
      };
    },
  },

  exposureUntried: {
    severity: 'info',
    audience: 'method', section: 'method',
    when: q => q.exposure.untried.length > 0,
    render: q => ({
      text: `Coverage: {n} language-and-route {adjword} deliberately not attempted here, ` +
            `each with a recorded reason — usually that the language has no such ` +
            `facility for the route to use. Nothing above is silent about an untested ` +
            `case.`,
      slots: {
        n: q.exposure.untried.length,
        adjword: plural(q.exposure.untried.length, 'adjudication is', 'adjudications are'),
      },
      cites: q.exposure.untried.map(u => `adj:${u.language}/${u.property}/${u.route}`),
    }),
  },
};

/* --------------------------------------------------------------- rendering */

function fill(text, slots) {
  return text.replace(/\{(\w+)\}/g, (m, k) =>
    (k in slots ? String(slots[k]) : m));
}

/* Render every template whose `when` holds. Returns statements in template
 * order, each with its severity, filled text, raw slots and citations.
 *
 * A template may also return `table: {columns, rows}` — the same facts set out
 * so they can be compared down a column instead of read along a line. Every cell
 * is flattened back into `slots` under a generated key, which is not decoration:
 * it puts table values under exactly the checks that already cover slot values,
 * so a number in a table is traced the same way as a number in a sentence. */
function render(q, db) {
  const out = [];
  for (const [id, t] of Object.entries(T)) {
    if (!t.when(q)) continue;
    const r = t.render(q, db);
    const slots = { ...r.slots };
    if (r.table) {
      r.table.rows.forEach((row, i) =>
        row.forEach((cell, j) => { slots[`t${i}_${j}`] = cell; }));
    }
    out.push({ id, severity: t.severity, rank: t.rank || 50,
               audience: t.audience || 'advice', section: t.section || 'with',
               text: fill(r.text, r.slots),
               slots, table: r.table || null,
               display: r.display || null, cites: r.cites });
  }
  return out;
}

const SECTIONS = ['built', 'study', 'design', 'with', 'without', 'rare', 'gives',
                  'verdict', 'method'];
const TEMPLATES = { T, render, fill, plural, list, clauses, SECTIONS };
if (typeof module !== 'undefined' && module.exports) module.exports = TEMPLATES;
