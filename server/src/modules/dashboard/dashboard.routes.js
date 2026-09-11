/**
 * =============================================================================
 *  Dashboard — the numbers, computed on the server
 * =============================================================================
 *  WHY THE SERVER DOES THIS
 *  Counting reports, shortages and expiring batches in the browser would mean
 *  downloading every row to count it. These endpoints return a handful of
 *  integers instead — a few kilobytes rather than megabytes, which is the
 *  difference between a dashboard that opens instantly on a phone at the
 *  station and one that does not.
 *
 *  Every figure respects the caller's data scope: a team admin's dashboard
 *  counts only their teams' reports, using the same scope builder as the
 *  report list. There is no separate "dashboard scope" to drift out of sync.
 * =============================================================================
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { requirePermission } from '../../middleware/auth.js';
import { buildSubmissionScope, hasPermission } from '../../services/access.service.js';
import { getStockSummary } from '../inventory/inventory.service.js';

const router = Router();

/** UTC midnight today — matches the `@db.Date` columns. */
function startOfToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// -----------------------------------------------------------------------------
//  GET /api/dashboard/overview
//  The landing screen. Returns only the sections the caller may see, so the UI
//  can render whatever comes back without checking permissions itself.
// -----------------------------------------------------------------------------
router.get(
  '/overview',
  requirePermission('dashboard:view'),
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }) }),
  asyncHandler(async (req, res) => {
    const { days } = req.validated.query;
    const today = startOfToday();
    const since = addDays(today, -days);

    const overview = { period: { from: since, to: today, days } };

    // --- Equipment reports ---------------------------------------------------
    const scope = buildSubmissionScope(req.user);

    /**
     * Station-wide FIGURES are a separate concern from filing a report.
     *
     * A responder needs one thing from this screen: the vehicle they are on
     * today, and what was short on it. Counts of how many reports the station
     * filed, and a league table of the most frequent shortages, are management
     * information — interesting to a team admin, noise to someone about to go
     * out on a call.
     *
     * So the aggregate blocks are gated on `stats:view` and simply are not sent
     * to a responder. Not hidden by the UI — not sent. A permission that only
     * greys out a panel is not a permission.
     */
    const canSeeStatistics = hasPermission(req.user, 'stats:view');

    if (scope && !canSeeStatistics) {
      overview.myShift = await buildPersonalShift(req.user, today);
    }

    if (scope && canSeeStatistics) {
      const where = { ...scope, shiftDate: { gte: since, lte: today } };

      // One transaction = one round trip for all five counts. On a free-tier
      // database in another region this saves several hundred milliseconds.
      const [total, submitted, drafts, withCritical, withWarn] = await prisma.$transaction([
        prisma.formSubmission.count({ where }),
        prisma.formSubmission.count({ where: { ...where, status: { in: ['SUBMITTED', 'REVIEWED'] } } }),
        prisma.formSubmission.count({ where: { ...where, status: 'DRAFT' } }),
        prisma.formSubmission.count({ where: { ...where, criticalCount: { gt: 0 } } }),
        prisma.formSubmission.count({ where: { ...where, warnCount: { gt: 0 }, criticalCount: 0 } }),
      ]);

      overview.reports = { total, submitted, drafts, withCritical, withWarn };

      // The most frequently short items across the period — this is what tells
      // the station "we keep running out of tourniquets", which is the point of
      // collecting the reports at all.
      overview.topShortages = await computeTopShortages(where);
    }

    // --- Inventory -----------------------------------------------------------
    if (hasPermission(req.user, 'inventory.item:read')) {
      overview.inventory = await getStockSummary();
    }

    // --- People --------------------------------------------------------------
    if (hasPermission(req.user, 'user:read')) {
      const [activeUsers, pendingInvites, suspended] = await prisma.$transaction([
        prisma.user.count({ where: { status: 'ACTIVE' } }),
        prisma.invitation.count({
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
        prisma.user.count({ where: { status: 'SUSPENDED' } }),
      ]);

      overview.people = { activeUsers, pendingInvites, suspended };
    }

    res.json({ data: overview });
  }),
);

/**
 * What one responder needs on their home screen: the shifts they are rostered
 * on, and — once a report has been filed — what was short on that vehicle.
 *
 * Deliberately narrow. It returns nothing about anyone else's shifts, no
 * station totals, and no ranking. Only rows where this person is named as crew.
 *
 * @param {object} user  req.user
 * @param {Date}   today UTC midnight
 */
async function buildPersonalShift(user, today) {
  const assignments = await prisma.assignment.findMany({
    where: {
      // The scope IS the filter: only shifts this person is rostered on.
      OR: [{ firstPersonId: user.id }, { secondPersonId: user.id }],
      // Yesterday through the next week — enough to cover "I forgot to file
      // yesterday's" without becoming an archive.
      shiftDate: { gte: addDays(today, -1), lte: addDays(today, 7) },
    },
    orderBy: { shiftDate: 'asc' },
    select: {
      id: true,
      shiftDate: true,
      notes: true,
      team: { select: { id: true, nameEn: true, nameAr: true } },
      vehicle: { select: { id: true, code: true, nameEn: true, nameAr: true, kind: true } },
      firstPerson: { select: { id: true, fullName: true } },
      secondPerson: { select: { id: true, fullName: true } },
    },
  });

  if (assignments.length === 0) {
    return { assignments: [], hasAnyAssignment: false };
  }

  // Whether each shift has a report yet, and what it found. One query for all
  // of them rather than one per card.
  const submissions = await prisma.formSubmission.findMany({
    where: {
      vehicleId: { in: assignments.map((assignment) => assignment.vehicle.id) },
      shiftDate: { in: assignments.map((assignment) => assignment.shiftDate) },
    },
    select: {
      id: true,
      vehicleId: true,
      shiftDate: true,
      status: true,
      criticalCount: true,
      warnCount: true,
      summary: true,
      submittedById: true,
    },
  });

  const keyOf = (vehicleId, shiftDate) => `${vehicleId}:${shiftDate.toISOString().slice(0, 10)}`;
  const byKey = new Map(
    submissions.map((submission) => [keyOf(submission.vehicleId, submission.shiftDate), submission]),
  );

  return {
    hasAnyAssignment: true,
    assignments: assignments.map((assignment) => {
      const submission = byKey.get(keyOf(assignment.vehicle.id, assignment.shiftDate)) ?? null;

      return {
        ...assignment,
        isToday: assignment.shiftDate.getTime() === today.getTime(),
        report: submission
          ? {
              id: submission.id,
              status: submission.status,
              criticalCount: submission.criticalCount,
              warnCount: submission.warnCount,
              // The shortages themselves — this is the part a responder needs
              // to see, and the reason the whole check exists.
              issues: submission.summary?.issues ?? [],
              completeness: submission.summary?.completeness ?? 0,
            }
          : null,
      };
    }),
  };
}

/**
 * Aggregates the stored `summary.issues` of recent reports into a ranked list.
 *
 * Reads the pre-computed JSON rather than re-evaluating thresholds: the
 * verdicts were already decided at submit time (see threshold.service.js), and
 * re-deriving them here could disagree with what the report itself shows.
 *
 * Capped at 300 reports — enough for a meaningful ranking over any sensible
 * period, and bounded so this endpoint's cost cannot grow with the archive.
 */
async function computeTopShortages(where) {
  const submissions = await prisma.formSubmission.findMany({
    where: { ...where, status: { in: ['SUBMITTED', 'REVIEWED'] } },
    select: { summary: true },
    orderBy: { shiftDate: 'desc' },
    take: 300,
  });

  const tally = new Map();

  for (const submission of submissions) {
    for (const issue of submission.summary?.issues ?? []) {
      // Group by field + row so "Airways — Red" and "Airways — Blue" rank
      // separately; they are different physical shortages.
      const key = `${issue.field}::${issue.row ?? ''}`;

      const entry = tally.get(key) ?? {
        key,
        label: issue.label,
        labelAr: issue.labelAr,
        section: issue.section,
        linkedItemId: issue.linkedItemId ?? null,
        critical: 0,
        warn: 0,
        total: 0,
      };

      if (issue.severity === 'CRITICAL') entry.critical += 1;
      else if (issue.severity === 'WARN') entry.warn += 1;
      entry.total += 1;

      tally.set(key, entry);
    }
  }

  return [...tally.values()]
    // Critical occurrences dominate the ranking; total breaks ties.
    .sort((a, b) => b.critical - a.critical || b.total - a.total)
    .slice(0, 10);
}

// -----------------------------------------------------------------------------
//  GET /api/dashboard/fleet
//  Every vehicle's current state, in one request.
// -----------------------------------------------------------------------------
router.get(
  '/fleet',
  requirePermission('vehicle:read'),
  asyncHandler(async (req, res) => {
    const today = startOfToday();

    /**
     * The question this answers is "is the fleet ready right now?", which is
     * the one thing worth having on screen at all times.
     *
     * The scope still applies: a Team Equipment Officer sees the state of every
     * vehicle (they need to know the fleet is covered) but only the reports
     * their scope allows, so a vehicle checked by another team shows as
     * reported without exposing that team's findings.
     */
    const scope = buildSubmissionScope(req.user) ?? { id: '__none__' };

    const vehicles = await prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: [{ kind: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        kind: true,
        _count: { select: { ruleOverrides: true } },
      },
    });

    const vehicleIds = vehicles.map((vehicle) => vehicle.id);

    // The most recent report per vehicle. Fetched as one query over a bounded
    // window rather than one query per vehicle — six round trips for a panel
    // that renders on every dashboard load would be a poor trade.
    const recent = await prisma.formSubmission.findMany({
      where: {
        ...scope,
        vehicleId: { in: vehicleIds },
        shiftDate: { gte: addDays(today, -14) },
      },
      select: {
        vehicleId: true,
        shiftDate: true,
        status: true,
        criticalCount: true,
        warnCount: true,
        submittedBy: { select: { fullName: true } },
        team: { select: { nameEn: true, nameAr: true } },
      },
      orderBy: { shiftDate: 'desc' },
    });

    // Open restock work, so a vehicle shows as "being dealt with" rather than
    // merely short — those are different situations for whoever is reading.
    const openRestocks = await prisma.restockRequest.groupBy({
      by: ['vehicleId', 'status'],
      where: {
        vehicleId: { in: vehicleIds },
        status: { in: ['OPEN', 'PREPARING', 'READY'] },
      },
      _count: true,
    });

    const latestByVehicle = new Map();
    for (const submission of recent) {
      // `recent` is sorted newest first, so the first one wins.
      if (!latestByVehicle.has(submission.vehicleId)) {
        latestByVehicle.set(submission.vehicleId, submission);
      }
    }

    const restockByVehicle = new Map();
    for (const row of openRestocks) {
      const current = restockByVehicle.get(row.vehicleId) ?? { total: 0, ready: 0 };
      current.total += row._count;
      if (row.status === 'READY') current.ready += row._count;
      restockByVehicle.set(row.vehicleId, current);
    }

    const rows = vehicles.map((vehicle) => {
      const latest = latestByVehicle.get(vehicle.id) ?? null;
      const restock = restockByVehicle.get(vehicle.id) ?? { total: 0, ready: 0 };

      const checkedToday = latest
        ? latest.shiftDate.getTime() === today.getTime() && latest.status !== 'DRAFT'
        : false;

      /**
       * One value the UI colours the tile by.
       *
       * NOT_CHECKED leads deliberately: a vehicle nobody has looked at today is
       * a bigger unknown than one that was checked and found slightly short.
       */
      let status;
      if (!checkedToday) status = 'NOT_CHECKED';
      else if (latest.criticalCount > 0) status = 'CRITICAL';
      else if (latest.warnCount > 0) status = 'WARN';
      else status = 'OK';

      return {
        vehicle: {
          id: vehicle.id,
          code: vehicle.code,
          nameEn: vehicle.nameEn,
          nameAr: vehicle.nameAr,
          kind: vehicle.kind,
        },
        status,
        checkedToday,
        /** Null when nothing was filed in the last fortnight. */
        lastReport: latest
          ? {
              shiftDate: latest.shiftDate,
              status: latest.status,
              criticalCount: latest.criticalCount,
              warnCount: latest.warnCount,
              submittedBy: latest.submittedBy?.fullName ?? null,
              team: latest.team,
            }
          : null,
        openRestocks: restock.total,
        restocksReadyToCollect: restock.ready,
        /** How many rules this vehicle deviates from the standard form on. */
        ruleExceptions: vehicle._count.ruleOverrides,
      };
    });

    res.json({
      data: {
        asOf: new Date(),
        rows,
        totals: {
          vehicles: rows.length,
          checkedToday: rows.filter((row) => row.checkedToday).length,
          notChecked: rows.filter((row) => row.status === 'NOT_CHECKED').length,
          critical: rows.filter((row) => row.status === 'CRITICAL').length,
          warn: rows.filter((row) => row.status === 'WARN').length,
          ok: rows.filter((row) => row.status === 'OK').length,
          awaitingCollection: rows.reduce((sum, row) => sum + row.restocksReadyToCollect, 0),
        },
      },
    });
  }),
);

// -----------------------------------------------------------------------------
//  GET /api/dashboard/report-trend
//  Daily counts for the trend chart on the statistics screen.
// -----------------------------------------------------------------------------
router.get(
  '/report-trend',
  requirePermission('stats:view'),
  validate({ query: z.object({ days: z.coerce.number().int().min(7).max(180).default(30) }) }),
  asyncHandler(async (req, res) => {
    const scope = buildSubmissionScope(req.user);
    if (!scope) return res.json({ data: [] });

    const today = startOfToday();
    const since = addDays(today, -req.validated.query.days);

    const submissions = await prisma.formSubmission.findMany({
      where: { ...scope, shiftDate: { gte: since, lte: today } },
      select: { shiftDate: true, criticalCount: true, warnCount: true, status: true },
      orderBy: { shiftDate: 'asc' },
    });

    // Bucket by day in JavaScript rather than with a raw SQL date_trunc: the
    // volume here is small (one row per vehicle per day), and staying inside
    // Prisma keeps the code portable and readable.
    const byDate = new Map();

    for (const submission of submissions) {
      const key = submission.shiftDate.toISOString().slice(0, 10);

      const bucket = byDate.get(key) ?? { date: key, reports: 0, critical: 0, warn: 0 };
      bucket.reports += 1;
      if (submission.criticalCount > 0) bucket.critical += 1;
      else if (submission.warnCount > 0) bucket.warn += 1;

      byDate.set(key, bucket);
    }

    // Fill gaps so the chart shows a flat line on quiet days instead of
    // silently compressing the x-axis and implying reports every day.
    const series = [];
    for (let cursor = new Date(since); cursor <= today; cursor = addDays(cursor, 1)) {
      const key = cursor.toISOString().slice(0, 10);
      series.push(byDate.get(key) ?? { date: key, reports: 0, critical: 0, warn: 0 });
    }

    res.json({ data: series });
  }),
);

export default router;
