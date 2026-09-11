/**
 * =============================================================================
 *  API route index
 * =============================================================================
 *  The map of the whole API. Reading this file tells you every URL the server
 *  answers and, just as importantly, which ones are public.
 *
 *  THE SECURITY BOUNDARY IS LINE-BASED AND DELIBERATE:
 *
 *      /auth               mounted BEFORE `authenticate`  -> partly public
 *      everything else     mounted AFTER  `authenticate`  -> always protected
 *
 *  Adding a new module below the boundary makes it authenticated by default.
 *  That is the safe direction for a mistake: forgetting a guard yields a 401,
 *  not an open endpoint.
 * =============================================================================
 */

import { Router } from 'express';

import authRoutes from './modules/auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import rolesRoutes from './modules/roles/roles.routes.js';
import teamsRoutes from './modules/teams/teams.routes.js';
import vehiclesRoutes from './modules/vehicles/vehicles.routes.js';
import vehicleRulesRoutes from './modules/vehicles/vehicleRules.routes.js';
import assignmentsRoutes from './modules/assignments/assignments.routes.js';
import inventoryRoutes from './modules/inventory/inventory.routes.js';
import formsRoutes from './modules/forms/forms.routes.js';
import submissionsRoutes from './modules/submissions/submissions.routes.js';
import restockRoutes from './modules/restock/restock.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import auditRoutes from './modules/audit/audit.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';

import { authenticate, enforcePasswordChange } from './middleware/auth.js';

const router = Router();

// =============================================================================
//  PUBLIC ZONE
// =============================================================================
//  The auth module applies `authenticate` internally, partway down its own file
//  — login and invitation acceptance must be reachable without a session, while
//  /auth/me and /auth/change-password must not.
// =============================================================================

router.use('/auth', authRoutes);

// =============================================================================
//  AUTHENTICATED ZONE
// =============================================================================

// Establishes req.user for everything below. One call, not one per module.
router.use(authenticate);

/**
 * A user whose password was reset by an admin can reach only a small allow-list
 * of endpoints until they choose a new one. Enforced here, on the server, so it
 * cannot be skipped by navigating around the frontend prompt.
 */
router.use(enforcePasswordChange);

router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/teams', teamsRoutes);
// Rule exceptions first: '/:id/rules' must be matched before the CRUD
// factory's '/:id' pattern can swallow it.
router.use('/vehicles', vehicleRulesRoutes);
router.use('/vehicles', vehiclesRoutes);
router.use('/assignments', assignmentsRoutes);

/** Serves BOTH the clothing store and the medical equipment store. */
router.use('/inventory', inventoryRoutes);

/** The form builder (templates, questions, thresholds). */
router.use('/forms', formsRoutes);

/** Filled equipment reports and the team day board. */
router.use('/submissions', submissionsRoutes);

/** The restock board: shortages becoming stock on a vehicle. */
router.use('/restock', restockRoutes);

router.use('/dashboard', dashboardRoutes);
router.use('/audit', auditRoutes);
router.use('/settings', settingsRoutes);

export default router;
