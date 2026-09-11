/**
 * =============================================================================
 *  Database seed
 * =============================================================================
 *  Fills an empty database with everything the station needs to start working:
 *  roles, the first super admin, the seven day teams, the vehicles, the two
 *  inventory categories with their item lists, and the equipment report forms.
 *
 *      npm run db:seed
 *
 *  IDEMPOTENT BY DESIGN. Every write is an upsert keyed on a stable business
 *  key, so running it twice changes nothing and running it against a live
 *  database will not duplicate or overwrite real data. That matters because you
 *  WILL want to re-run it after adding items to seed-data/items.js.
 *
 *  The one exception is the equipment report template: it is only created if no
 *  template with that key exists at all, because re-seeding a form the super
 *  admin has since edited would throw their work away.
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { SEED_ROLES } from '../src/config/permissions.js';
import { categories, medicalItems, clothingItems, vehicles, teams } from './seed-data/items.js';
import { ambulanceEquipmentForm, erRoomEquipmentForm } from './seed-data/equipment-form.js';

const prisma = new PrismaClient();

/** Small console helpers — the seed is run by a person watching a terminal. */
const step = (message) => console.log(`\n  ${message}`);
const done = (message) => console.log(`     ${message}`);

async function main() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  LRC-401 — seeding the database');
  console.log('══════════════════════════════════════════════════════════');

  // ===========================================================================
  //  1. ROLES
  // ===========================================================================
  step('Roles');

  for (const role of SEED_ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      create: role,
      // On re-run we refresh the names and the permission list. This is how a
      // newly added permission reaches the existing built-in roles — otherwise
      // a fresh install and an upgraded one would drift apart.
      update: {
        nameEn: role.nameEn,
        nameAr: role.nameAr,
        description: role.description,
        permissions: role.permissions,
      },
    });
    done(`${role.nameEn} (${role.permissions.length} permissions)`);
  }

  // ===========================================================================
  //  2. SUPER ADMIN
  // ===========================================================================
  step('Super admin');

  const email = (process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@lrc401.local').toLowerCase();
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe!2026';

  const existingAdmin = await prisma.user.findUnique({ where: { email } });

  if (existingAdmin) {
    // Never touch the password of an account that already exists — on a live
    // system that would silently reset the real admin's credentials.
    done(`${email} already exists — left untouched`);
  } else {
    await prisma.user.create({
      data: {
        email,
        fullName: process.env.SEED_SUPERADMIN_NAME ?? 'Station Super Admin',
        passwordHash: await bcrypt.hash(password, 12),
        status: 'ACTIVE',
        isSuperAdmin: true,
        // Forces a new password at first login, so the value from .env is never
        // the long-term credential.
        mustChangePassword: true,
      },
    });

    done(`Created ${email}`);
    done(`Password: ${password}   <-- change this at first login`);
  }

  // ===========================================================================
  //  3. TEAMS
  // ===========================================================================
  step('Teams');

  for (const team of teams) {
    await prisma.team.upsert({ where: { key: team.key }, create: team, update: {} });
  }
  done(`${teams.length} day teams`);

  // ===========================================================================
  //  4. VEHICLES
  // ===========================================================================
  step('Vehicles');

  for (const vehicle of vehicles) {
    await prisma.vehicle.upsert({ where: { code: vehicle.code }, create: vehicle, update: {} });
  }
  done(`${vehicles.length} vehicles (including the ER room)`);

  // ===========================================================================
  //  4b. STORAGE LOCATIONS
  // ===========================================================================
  //  Stock moves along a chain:  MAIN STORE -> DAILY CABINET -> VEHICLE
  //
  //  Deliveries land in the store. Each morning the crews draw from the daily
  //  cabinet. Restocking a vehicle takes from the cabinet. Every step is a
  //  TRANSFER, so at any moment it is answerable where a given box of gloves
  //  actually is.
  // ===========================================================================
  step('Storage locations');

  const mainStore = await prisma.storageLocation.upsert({
    where: { key: 'main_store' },
    create: {
      key: 'main_store',
      nameEn: 'Main Store',
      nameAr: 'المستودع الرئيسي',
      kind: 'STORE',
      // Deliveries land here, and it is the default source for a transfer.
      isDefault: true,
      sortOrder: 0,
    },
    update: {},
  });

  await prisma.storageLocation.upsert({
    where: { key: 'daily_cabinet' },
    create: {
      key: 'daily_cabinet',
      nameEn: 'Daily Cabinet',
      nameAr: 'الخزانة اليومية',
      kind: 'CABINET',
      sortOrder: 1,
    },
    update: {},
  });

  done('Main Store (default) + Daily Cabinet');

  // One location per vehicle, so restocking 472 is an ordinary transfer and the
  // vehicle's own holdings show up like any other balance.
  const allVehicles = await prisma.vehicle.findMany({ select: { id: true, code: true, nameEn: true, nameAr: true } });

  for (const [index, vehicle] of allVehicles.entries()) {
    await prisma.storageLocation.upsert({
      where: { key: `vehicle_${vehicle.code.toLowerCase()}` },
      create: {
        key: `vehicle_${vehicle.code.toLowerCase()}`,
        nameEn: vehicle.nameEn,
        nameAr: vehicle.nameAr,
        kind: 'VEHICLE',
        vehicleId: vehicle.id,
        sortOrder: 10 + index,
      },
      update: {},
    });
  }

  done(`${allVehicles.length} vehicle locations`);

  // ===========================================================================
  //  5. INVENTORY CATEGORIES + THEIR DYNAMIC FIELDS
  // ===========================================================================
  step('Inventory categories');

  const categoryByKey = {};

  for (const { attributeDefs, ...category } of categories) {
    const saved = await prisma.itemCategory.upsert({
      where: { key: category.key },
      create: category,
      update: { nameEn: category.nameEn, nameAr: category.nameAr, icon: category.icon },
    });

    categoryByKey[category.key] = saved;

    for (const definition of attributeDefs) {
      await prisma.itemAttributeDef.upsert({
        where: { categoryId_key: { categoryId: saved.id, key: definition.key } },
        create: { ...definition, categoryId: saved.id },
        update: {},
      });
    }

    done(`${category.nameEn} (${attributeDefs.length} custom fields)`);
  }

  // ===========================================================================
  //  6. ITEMS
  // ===========================================================================
  step('Items');

  let created = 0;
  let skipped = 0;

  // --- Medical equipment ----------------------------------------------------
  for (const [nameEn, nameAr, trackExpiry, unit] of medicalItems) {
    // Matched on (category, name) rather than upserted on a unique key: `sku`
    // is optional and most of these have none, so the name is the only stable
    // identifier available.
    const existing = await prisma.item.findFirst({
      where: { categoryId: categoryByKey.medical_equipment.id, nameEn },
      select: { id: true },
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.item.create({
      data: {
        categoryId: categoryByKey.medical_equipment.id,
        nameEn,
        nameAr,
        unit,
        trackExpiry,
        trackSize: false,
        // A sensible default so the low-stock warning does something useful on
        // day one; the storekeeper tunes it per item afterwards.
        lowStockThreshold: 5,
      },
    });

    created += 1;
  }

  // --- Clothing -------------------------------------------------------------
  for (const [nameEn, nameAr, sizes] of clothingItems) {
    const existing = await prisma.item.findFirst({
      where: { categoryId: categoryByKey.clothing.id, nameEn },
      select: { id: true },
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.item.create({
      data: {
        categoryId: categoryByKey.clothing.id,
        nameEn,
        nameAr,
        unit: 'piece',
        trackExpiry: false,
        trackSize: true,
        sizes,
        lowStockThreshold: 3,
      },
    });

    created += 1;
  }

  done(`${created} created, ${skipped} already present`);

  // ===========================================================================
  //  7. EQUIPMENT REPORT FORMS
  // ===========================================================================
  step('Equipment report forms');

  for (const form of [ambulanceEquipmentForm, erRoomEquipmentForm]) {
    const existing = await prisma.formTemplate.findFirst({
      where: { key: form.key },
      select: { id: true, version: true, status: true },
    });

    if (existing) {
      // See the header note: never overwrite a form the super admin may have
      // edited. To load a fresh copy, delete the old versions first.
      done(`"${form.titleEn}" already exists (v${existing.version}) — left untouched`);
      continue;
    }

    const { sections, ...templateData } = form;

    const template = await prisma.formTemplate.create({
      data: {
        ...templateData,
        version: 1,
        // Published immediately so the station can file a report the moment the
        // seed finishes, rather than hunting for a "publish" button first.
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });

    let fieldCount = 0;

    for (const [sectionIndex, section] of sections.entries()) {
      const { fields, ...sectionData } = section;

      const savedSection = await prisma.formSection.create({
        data: { ...sectionData, templateId: template.id, sortOrder: sectionIndex },
      });

      await prisma.formField.createMany({
        data: fields.map((field, fieldIndex) => ({
          ...field,
          sectionId: savedSection.id,
          sortOrder: fieldIndex,
        })),
      });

      fieldCount += fields.length;
    }

    done(`"${form.titleEn}" — ${sections.length} sections, ${fieldCount} questions, published`);
  }

  // ===========================================================================
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Seed complete.');
  console.log(`  Sign in at ${process.env.CLIENT_URL ?? 'http://localhost:5173'}`);
  console.log(`  Email: ${email}`);
  console.log('══════════════════════════════════════════════════════════\n');
}

main()
  .catch((error) => {
    console.error('\n  Seed failed:\n', error);
    // Non-zero exit so a failing seed breaks a deployment pipeline instead of
    // being mistaken for success.
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
