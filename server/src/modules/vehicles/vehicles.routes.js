/**
 * =============================================================================
 *  Vehicles — the ambulances (470–475) and the ER Room.
 * =============================================================================
 *  The ER Room is modelled as a "vehicle" with `kind = ER_ROOM` rather than as
 *  a separate table. It behaves identically everywhere that matters: it gets
 *  assigned to people on a date, it has an equipment report, and it gets
 *  restocked. Giving it its own table would duplicate the assignment and report
 *  logic for no gain — which is exactly what your Google Form already does by
 *  listing it as one more option next to 470–475.
 * =============================================================================
 */

import { z } from 'zod';
import { AUDIT_ACTIONS } from '../../services/audit.service.js';
import { createCrudRouter, crudListQuery } from '../../utils/crudRouter.js';

const createVehicleSchema = z.object({
  /** Displayed identifier: "470", "ER". Unique across the station. */
  code: z.string().trim().min(1).max(20),
  nameEn: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().min(1).max(80),
  kind: z.enum(['AMBULANCE', 'ER_ROOM', 'OTHER']).default('AMBULANCE'),
});

const updateVehicleSchema = createVehicleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/** Adds a `kind` filter so the UI can show only ambulances when it needs to. */
const listVehiclesQuery = crudListQuery.extend({
  kind: z.enum(['AMBULANCE', 'ER_ROOM', 'OTHER']).optional(),
});

export default createCrudRouter({
  modelName: 'vehicle',
  entityType: 'Vehicle',
  permissions: { read: 'vehicle:read', manage: 'vehicle:manage' },
  schemas: { create: createVehicleSchema, update: updateVehicleSchema, listQuery: listVehiclesQuery },
  searchFields: ['code', 'nameEn', 'nameAr'],
  // Lets the UI ask for only ambulances (or only the ER Room).
  extraFilters: (query) => (query.kind ? { kind: query.kind } : {}),
  // Numeric-looking codes sort correctly as text here because they are all the
  // same length ("470".."475"); the ER Room sorts after them, which is the
  // order the paper form uses.
  orderBy: { code: 'asc' },
  auditActions: {
    created: AUDIT_ACTIONS.VEHICLE_CREATED,
    updated: AUDIT_ACTIONS.VEHICLE_UPDATED,
    deleted: AUDIT_ACTIONS.VEHICLE_UPDATED,
  },
});
