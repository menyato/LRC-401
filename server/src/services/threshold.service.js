/**
 * =============================================================================
 *  Threshold engine
 * =============================================================================
 *  Turns a filled equipment report into the answer the team admin actually
 *  wants: "what is missing on this vehicle, and how badly?"
 *
 *  WHY THIS RUNS ON THE SERVER, AT SUBMIT TIME
 *  -------------------------------------------
 *  We could recompute shortages in the browser whenever a report is opened.
 *  We deliberately do not, for three reasons:
 *
 *    1. HISTORY MUST NOT CHANGE. If the super admin raises the expected number
 *       of tourniquets from 2 to 4 next month, last week's report must still
 *       read as it did when it was filed. Storing the computed result freezes
 *       the judgement alongside the answers.
 *    2. SPEED ON A PHONE. The team dashboard shows a week of reports at once.
 *       Re-evaluating ~200 fields per report in the browser is wasted work on
 *       a device that may be on 3G in a basement.
 *    3. ONE SOURCE OF TRUTH. Sorting reports by severity, warning emails and
 *       the dashboard all read the same stored numbers, so they can never
 *       disagree with what the user sees.
 *
 *  THRESHOLD SHAPE (set by the super admin in the form builder):
 *
 *      { "expected": 2, "warnBelow": 2, "criticalBelow": 1 }
 *
 *      value >= warnBelow                  -> OK
 *      criticalBelow <= value < warnBelow  -> WARN     (amber)
 *      value < criticalBelow               -> CRITICAL (red)
 * =============================================================================
 */

/** Severity levels, widest-to-narrowest urgency. */
export const SEVERITY = { OK: 'OK', WARN: 'WARN', CRITICAL: 'CRITICAL' };

/**
 * How urgently a shortage must be put right.
 *
 * SEPARATE FROM SEVERITY, and the distinction matters:
 *
 *   SEVERITY answers "how far below the threshold is this?" — it is computed
 *            from the numbers on the day.
 *   PRIORITY answers "how much does this item matter?" — it is a judgement the
 *            District Equipment Chief makes once, in the form builder.
 *
 * A vehicle missing one of two tourniquets and missing one of two vomit bags
 * are both CRITICAL by the numbers. They are not the same problem. Priority is
 * what lets the restock board put the tourniquet first.
 */
export const PRIORITY = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
};

/** Rank for sorting — lower sorts first. */
export const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/**
 * Grades one number against one threshold.
 *
 * @param {number} value
 * @param {{expected?:number, warnBelow?:number, criticalBelow?:number}} [threshold]
 * @returns {'OK'|'WARN'|'CRITICAL'}
 */
function grade(value, threshold) {
  // No threshold configured = nothing to be short of. Most free-text and
  // informational fields fall here.
  if (!threshold) return SEVERITY.OK;

  const { warnBelow, criticalBelow } = threshold;

  // Critical is checked first: when both bounds are set and the value is below
  // both, the more urgent verdict must win.
  if (criticalBelow !== undefined && criticalBelow !== null && value < criticalBelow) {
    return SEVERITY.CRITICAL;
  }

  if (warnBelow !== undefined && warnBelow !== null && value < warnBelow) {
    return SEVERITY.WARN;
  }

  return SEVERITY.OK;
}

/**
 * Coerces a stored answer into a number.
 *
 * Answers arrive from JSONB and from radio inputs, so a count can legitimately
 * be `2`, `"2"`, or the string `"5+"` used by your form's top choice. Anything
 * unparseable is treated as 0 — a missing answer for a required count is a
 * shortage, not something to ignore.
 */
function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  if (typeof value === 'string') {
    // "5+" -> 5. The plus means "at least", so the lower bound is the safe read.
    const parsed = Number.parseInt(value.replace('+', ''), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (typeof value === 'boolean') return value ? 1 : 0;

  return 0;
}

/**
 * Evaluates a whole submission.
 *
 * @param {Array<{key:string, labelEn:string, labelAr:string, type:string,
 *                isRequired:boolean, config:object, sectionTitleEn?:string}>} fields
 *        Flattened list of every field in the template, in display order.
 * @param {Record<string, unknown>} answers
 *        `{ fieldKey: value }`; GRID values are `{ rowKey: number }`.
 *
 * @returns {{counts:{ok:number,warn:number,critical:number,missing:number},
 *            issues:Array<object>, completeness:number}}
 */
export function evaluateSubmission(fields, answers = {}, overrides = []) {
  const counts = { ok: 0, warn: 0, critical: 0, missing: 0 };
  const issues = [];

  /**
   * Per-vehicle exceptions, indexed for lookup.
   *
   * Every vehicle fills in the same form, but the fleet is not identical: one
   * may carry no Matlat at all, another a different brand of splint that should
   * not be flagged. Without exceptions, those vehicles would be permanently red
   * for equipment they are not supposed to have — and a dashboard that is
   * always red stops being read, which is how a REAL shortage gets missed.
   *
   * Key is "fieldKey::rowKey", with an empty row meaning the whole question.
   */
  const overrideMap = new Map(
    overrides.map((rule) => [`${rule.fieldKey}::${rule.rowKey || ''}`, rule]),
  );

  const overrideFor = (fieldKey, rowKey = null) =>
    overrideMap.get(`${fieldKey}::${rowKey || ''}`) ?? null;

  /**
   * Merges an exception onto the form's own threshold.
   *
   * Any part the exception leaves null falls through to the form's value, so
   * "this vehicle needs 1 instead of 2" is a single number rather than a full
   * restatement of the rule.
   */
  const applyOverride = (threshold, rule) => {
    if (!rule) return threshold;

    const merged = { ...(threshold ?? {}) };

    if (rule.expected !== null && rule.expected !== undefined) {
      merged.expected = rule.expected;
      // Keep the derived levels consistent unless the exception states its own,
      // otherwise lowering "expected" alone would leave a warning level above it
      // and the question would be permanently amber.
      merged.warnBelow = rule.warnBelow ?? rule.expected;
      merged.criticalBelow = rule.criticalBelow ?? Math.min(1, rule.expected);
    }

    if (rule.warnBelow !== null && rule.warnBelow !== undefined) {
      merged.warnBelow = rule.warnBelow;
    }
    if (rule.criticalBelow !== null && rule.criticalBelow !== undefined) {
      merged.criticalBelow = rule.criticalBelow;
    }

    return merged;
  };

  let answerable = 0;
  let answered = 0;

  for (const field of fields) {
    // Purely presentational — nothing to grade or count.
    if (field.type === 'SECTION_NOTE') continue;

    const fieldRule = overrideFor(field.key);

    // This vehicle does not carry the item at all. Not graded, not counted, and
    // not reported as unanswered — it is simply not part of this vehicle's form.
    if (fieldRule?.isExcluded) continue;

    const config = field.config ?? {};
    const rawAnswer = answers[field.key];
    const isBlank = rawAnswer === undefined || rawAnswer === null || rawAnswer === '';

    answerable += 1;
    if (!isBlank) answered += 1;

    // --- Unanswered required field -----------------------------------------
    // Reported separately from a shortage: "nobody checked this" is a different
    // problem from "we checked and it is short", and the team admin needs to
    // tell them apart.
    if (isBlank && field.isRequired) {
      counts.missing += 1;
      issues.push({
        field: field.key,
        label: field.labelEn,
        labelAr: field.labelAr,
        section: field.sectionTitleEn,
        severity: SEVERITY.CRITICAL,
        kind: 'NOT_ANSWERED',
        priority: config.priority ?? PRIORITY.NORMAL,
        value: null,
        expected: config.threshold?.expected ?? null,
      });
      continue;
    }

    if (isBlank) continue;

    // --- GRID: per-row thresholds, and optionally a GROUP threshold --------
    // This is the shape most of your form uses ("Airways: Blue/Red/Yellow…").
    if (field.type === 'GRID') {
      const rows = config.rows ?? [];
      const rowAnswers = typeof rawAnswer === 'object' && rawAnswer !== null ? rawAnswer : {};

      for (const row of rows) {
        const rowRule = overrideFor(field.key, row.key);

        // This vehicle does not carry this particular row (a size, a colour) —
        // skip it entirely, and leave it out of the group total below too.
        if (rowRule?.isExcluded) continue;

        // A row with no threshold of its own is still counted toward the group
        // total below, but is not judged individually.
        const value = toNumber(rowAnswers[row.key]);

        const rowThreshold = applyOverride(row.threshold, rowRule);

        if (!rowThreshold) continue;

        const severity = grade(value, rowThreshold);

        tally(counts, severity);

        if (severity !== SEVERITY.OK) {
          issues.push({
            field: field.key,
            row: row.key,
            // Combined label so the dashboard can show one readable line
            // ("Airways — Red") without re-joining anything client-side.
            label: `${field.labelEn} — ${row.labelEn}`,
            labelAr: `${field.labelAr} — ${row.labelAr ?? row.labelEn}`,
            section: field.sectionTitleEn,
            severity,
            kind: 'SHORTAGE',
            priority: rowRule?.priority ?? row.priority ?? config.priority ?? PRIORITY.NORMAL,
            value,
            expected: rowThreshold?.expected ?? null,
            // Marks the issue as judged against a vehicle-specific rule, so the
            // report can say so rather than looking like an inconsistency.
            ...(rowRule ? { overridden: true } : {}),
            linkedItemId: row.linkedItemId ?? field.linkedItemId ?? null,
          });
        }
      }

      /**
       * GROUP THRESHOLD — judges the rows TOGETHER rather than one by one.
       *
       * This is what expresses "we need at least 2 boxes of gloves in total,
       * and it does not matter which sizes they are". Per-row thresholds cannot
       * say that: they would either demand 2 of EVERY size (far too strict) or
       * accept 2 smalls and no larges (not what was meant).
       *
       * Configured on the field as:
       *
       *     config.groupThreshold = { expected: 2, warnBelow: 2, criticalBelow: 1 }
       *
       * Per-row and group thresholds compose: a field may have both, and each
       * raises its own issue. "At least one of every size AND four in total" is
       * a perfectly reasonable rule, and this supports it.
       */
      const groupThreshold = applyOverride(config.groupThreshold, fieldRule);

      if (groupThreshold) {
        // Sum EVERY row that this vehicle actually carries — an excluded row
        // must not drag the total down and invent a shortage.
        const total = rows
          .filter((row) => !overrideFor(field.key, row.key)?.isExcluded)
          .reduce((sum, row) => sum + toNumber(rowAnswers[row.key]), 0);

        const severity = grade(total, groupThreshold);

        tally(counts, severity);

        if (severity !== SEVERITY.OK) {
          issues.push({
            field: field.key,
            // No `row` — this issue is about the field as a whole, which is how
            // the UI tells a group shortage from a per-row one.
            row: null,
            isGroup: true,
            label: `${field.labelEn} — total`,
            labelAr: `${field.labelAr} — المجموع`,
            section: field.sectionTitleEn,
            severity,
            kind: 'SHORTAGE',
            priority: fieldRule?.priority ?? config.priority ?? PRIORITY.NORMAL,
            value: total,
            expected: groupThreshold.expected ?? null,
            ...(fieldRule ? { overridden: true } : {}),
            linkedItemId: field.linkedItemId ?? null,
          });
        }
      }

      continue;
    }

    // --- SINGLE_SELECT: severity attached to the chosen option -------------
    // Used for qualitative answers such as "Betadine content: empty to quarter",
    // where there is no number to compare but the choice itself is a problem.
    if (field.type === 'SINGLE_SELECT') {
      const option = (config.options ?? []).find((candidate) => candidate.value === rawAnswer);
      const severity = option?.severity ?? SEVERITY.OK;

      tally(counts, severity);

      if (severity !== SEVERITY.OK) {
        issues.push({
          field: field.key,
          label: field.labelEn,
          labelAr: field.labelAr,
          section: field.sectionTitleEn,
          severity,
          kind: 'CONDITION',
          priority: config.priority ?? PRIORITY.NORMAL,
          value: option?.labelEn ?? rawAnswer,
          expected: null,
          linkedItemId: field.linkedItemId ?? null,
        });
      }

      continue;
    }

    // --- Everything numeric: NUMBER, NUMBER_CHOICE, BOOLEAN ----------------
    if (['NUMBER', 'NUMBER_CHOICE', 'BOOLEAN'].includes(field.type)) {
      const value = toNumber(rawAnswer);
      const fieldThreshold = applyOverride(config.threshold, fieldRule);
      const severity = grade(value, fieldThreshold);

      tally(counts, severity);

      if (severity !== SEVERITY.OK) {
        issues.push({
          field: field.key,
          label: field.labelEn,
          labelAr: field.labelAr,
          section: field.sectionTitleEn,
          severity,
          kind: 'SHORTAGE',
          priority: fieldRule?.priority ?? config.priority ?? PRIORITY.NORMAL,
          value,
          expected: fieldThreshold?.expected ?? null,
          linkedItemId: field.linkedItemId ?? null,
          ...(fieldRule ? { overridden: true } : {}),
        });
      }

      continue;
    }

    // TEXT, DATE, MULTI_SELECT — recorded, but nothing to grade.
    counts.ok += 1;
  }

  /**
   * Order: PRIORITY first, then severity.
   *
   * Priority leads because it encodes what the station decided matters, which
   * outranks how the numbers happened to fall on one particular day. A HIGH
   * item that is merely amber belongs above a LOW item that is red.
   */
  const severityRank = { CRITICAL: 0, WARN: 1, OK: 2 };

  issues.sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) ||
      severityRank[a.severity] - severityRank[b.severity],
  );

  return {
    counts,
    issues,
    /** 0–100, how much of the form was actually filled in. */
    completeness: answerable === 0 ? 100 : Math.round((answered / answerable) * 100),
  };
}

/** Increments the right bucket. Extracted so the branches above stay readable. */
function tally(counts, severity) {
  if (severity === SEVERITY.CRITICAL) counts.critical += 1;
  else if (severity === SEVERITY.WARN) counts.warn += 1;
  else counts.ok += 1;
}

/**
 * Flattens a template (sections -> fields) into the list `evaluateSubmission`
 * expects, carrying each field's section title along for display.
 *
 * @param {{sections: Array<{titleEn:string, titleAr:string, fields:Array}>}} template
 */
export function flattenTemplateFields(template) {
  return (template.sections ?? []).flatMap((section) =>
    (section.fields ?? []).map((field) => ({
      ...field,
      sectionTitleEn: section.titleEn,
      sectionTitleAr: section.titleAr,
    })),
  );
}
