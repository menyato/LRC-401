/**
 * Walks the whole restock loop end to end and prints what happened at each
 * step, so the stock chain (main store -> daily cabinet -> vehicle) can be seen
 * moving rather than taken on trust.
 *
 *   node scripts/check-restock-flow.js <superAdminEmail> <password>
 *
 * Everything it creates is prefixed RSTK- and is cleaned up at the end.
 */

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();

const [adminEmail, adminPassword] = process.argv.slice(2);
if (!adminEmail || !adminPassword) {
  console.error('\n  Usage: node scripts/check-restock-flow.js <email> <password>\n');
  process.exit(1);
}

const RUN = Date.now().toString(36);
const G = '\x1b[32m';
const R = '\x1b[31m';
const D = '\x1b[2m';
const X = '\x1b[0m';

const session = { token: null, cookie: null };

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) session.cookie = sc.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const ok = (cond) => (cond ? `${G}OK${X}` : `${R}FAIL${X}`);

/** Prints one item's balance in every location that holds it. */
async function showBalances(itemId, label) {
  const lots = await prisma.stockLot.findMany({
    where: { itemId },
    include: { location: { select: { nameEn: true, kind: true } } },
    orderBy: { location: { sortOrder: 'asc' } },
  });

  console.log(`\n  ${D}${label}${X}`);
  if (lots.length === 0) console.log('      (no stock anywhere)');
  for (const lot of lots) {
    console.log(
      `      ${lot.location.nameEn.padEnd(20)} ${String(lot.quantityOnHand).padStart(4)}` +
        `  ${D}${lot.location.kind}${X}`,
    );
  }
}

console.log('\n══════════════════════════════════════════════════════════');
console.log('  Restock flow — store ➜ cabinet ➜ vehicle');
console.log('══════════════════════════════════════════════════════════');

// --- Sign in ------------------------------------------------------------------
const login = await call('/auth/login', {
  method: 'POST',
  body: { email: adminEmail, password: adminPassword },
});
if (login.status !== 200) {
  console.error('  login failed:', JSON.stringify(login.body?.error));
  process.exit(1);
}
session.token = login.body.data.accessToken;

// --- Reference data -----------------------------------------------------------
const locations = await prisma.storageLocation.findMany({ orderBy: { sortOrder: 'asc' } });
const store = locations.find((l) => l.kind === 'STORE');
const cabinet = locations.find((l) => l.kind === 'CABINET');

console.log(`\n  Locations: ${locations.length}  (store="${store?.nameEn}", cabinet="${cabinet?.nameEn}")`);

const teams = (await call('/teams?limit=50')).body.data;
const vehicles = (await call('/vehicles?limit=50')).body.data;
const team = teams[0];
const vehicle = vehicles.find((v) => v.kind === 'AMBULANCE');
const vehicleLocation = locations.find((l) => l.vehicleId === vehicle.id);

console.log(`  Using team "${team.nameEn}", vehicle ${vehicle.code} (location "${vehicleLocation?.nameEn}")`);

// --- An item to move ----------------------------------------------------------
const categories = (await call('/inventory/categories')).body.data;
const medical = categories.find((c) => c.key === 'medical_equipment');

const item = (await call('/inventory/items', {
  method: 'POST',
  body: {
    categoryId: medical.id,
    nameEn: `RSTK-${RUN} Tourniquet`,
    unit: 'piece',
    trackSize: false,
    trackExpiry: false,
    lowStockThreshold: 2,
  },
})).body.data;

console.log(`\n  Created item "${item.nameEn}"`);

// --- 1. Receive into the main store -------------------------------------------
const receipt = await call('/inventory/movements', {
  method: 'POST',
  body: {
    itemId: item.id,
    direction: 'IN',
    quantity: 20,
    toLocationId: store.id,
    counterparty: 'RSTK supplier',
  },
});
console.log(`\n  1. Receive 20 into the main store        ${ok(receipt.status === 201)} (${receipt.status})`);
await showBalances(item.id, 'balances');

// --- 2. Transfer store ➜ cabinet ----------------------------------------------
const toCabinet = await call('/inventory/movements', {
  method: 'POST',
  body: {
    itemId: item.id,
    direction: 'TRANSFER',
    quantity: 8,
    fromLocationId: store.id,
    toLocationId: cabinet.id,
    reason: 'daily_top_up',
  },
});
console.log(`\n  2. Transfer 8 store ➜ daily cabinet      ${ok(toCabinet.status === 201)} (${toCabinet.status})`);
await showBalances(item.id, 'balances');

// --- 3. A report with a shortage ----------------------------------------------
const template = (await call('/forms/active?scope=AMBULANCE')).body.data;
const today = new Date().toISOString().slice(0, 10);

// Link the tourniquet question to our item so the restock line can move stock.
const tqField = template.sections
  .flatMap((s) => s.fields)
  .find((f) => f.key === 'tourniquet');

if (tqField) {
  await prisma.formField.update({ where: { id: tqField.id }, data: { linkedItemId: item.id } });
  console.log(`\n  Linked the "Tourniquet" question to the item`);
}

// Answer everything so it can be SUBMITTED, but leave tourniquets short.
const answers = {};
for (const section of template.sections) {
  for (const field of section.fields) {
    if (!field.isRequired) continue;
    if (field.type === 'GRID') {
      answers[field.key] = Object.fromEntries((field.config.rows ?? []).map((r) => [r.key, 5]));
    } else if (field.type === 'SINGLE_SELECT') {
      const safe = (field.config.options ?? []).find((o) => o.severity === 'OK');
      answers[field.key] = safe?.value ?? field.config.options?.[0]?.value;
    } else if (['NUMBER', 'NUMBER_CHOICE'].includes(field.type)) {
      answers[field.key] = 5;
    } else if (field.type === 'BOOLEAN') {
      answers[field.key] = true;
    } else {
      answers[field.key] = 'ok';
    }
  }
}
answers.tourniquet = 0; // the shortage we will restock

const submission = await call('/submissions', {
  method: 'POST',
  body: {
    templateId: template.id,
    vehicleId: vehicle.id,
    teamId: team.id,
    shiftDate: today,
    answers,
    status: 'SUBMITTED',
  },
});
console.log(`\n  3. Submit a report short on tourniquets  ${ok(submission.status === 201)} (${submission.status})`);

if (submission.status !== 201) {
  console.error('      ', JSON.stringify(submission.body?.error).slice(0, 400));
  process.exit(1);
}

const issues = submission.body.data.summary.issues ?? [];
const tqIssue = issues.find((i) => i.field === 'tourniquet');
console.log(`      shortages found: ${issues.length}`);
if (tqIssue) {
  console.log(
    `      tourniquet: ${tqIssue.value} of ${tqIssue.expected}  [${tqIssue.severity}, priority ${tqIssue.priority}]`,
  );
}

// --- 4. Raise a restock job ----------------------------------------------------
const job = await call(`/restock/from-submission/${submission.body.data.id}`, {
  method: 'POST',
  body: {
    selections: [{ field: 'tourniquet', row: null }],
    note: 'RSTK flow check',
  },
});
console.log(`\n  4. Raise a restock job from the report    ${ok(job.status === 201)} (${job.status})`);

if (job.status !== 201) {
  console.error('      ', JSON.stringify(job.body?.error).slice(0, 400));
  process.exit(1);
}

const request = job.body.data;
console.log(`      status=${request.status}  priority=${request.priority}  lines=${request.lines.length}`);
console.log(`      "${request.lines[0].label}"  needed=${request.lines[0].quantityNeeded}`);
console.log(`      ${request.sourceLocation.nameEn} ➜ ${request.targetLocation.nameEn}`);

// --- 5. The EQUIPMENT OFFICER gathers the items ---------------------------------
const preparing = await call(`/restock/${request.id}/status`, {
  method: 'PATCH',
  body: { status: 'PREPARING' },
});
console.log(
  `\n  5. OPEN ➜ PREPARING   (equipment officer) ${ok(preparing.status === 200)} (${preparing.status})`,
);

const ready = await call(`/restock/${request.id}/status`, {
  method: 'PATCH',
  body: { status: 'READY' },
});
console.log(`  6. PREPARING ➜ READY  (set aside)         ${ok(ready.status === 200)} (${ready.status})`);

// The officer's job ends here, and CRUCIALLY no stock has moved yet: the items
// are on a shelf waiting for the crew, not on an ambulance.
await showBalances(
  item.id,
  'balances at READY — nothing has moved yet, the items are still in the cabinet',
);

// --- 7. The CREW collects and confirms — this is what moves the stock -----------
const confirmed = await call(`/restock/${request.id}/status`, {
  method: 'PATCH',
  body: { status: 'CONFIRMED' },
});
console.log(
  `\n  7. READY ➜ CONFIRMED  (crew loaded it)    ${ok(confirmed.status === 200)} (${confirmed.status})`,
);

if (confirmed.status !== 200) {
  console.error('      ', JSON.stringify(confirmed.body?.error).slice(0, 400));
} else {
  await showBalances(item.id, 'balances after confirm — the cabinet fell and the vehicle rose');
}

// --- 8. Illegal transition must be refused --------------------------------------
const illegal = await call(`/restock/${request.id}/status`, {
  method: 'PATCH',
  body: { status: 'PREPARING' },
});
console.log(
  `  8. CONFIRMED ➜ PREPARING is refused      ${ok(illegal.status === 400)} (${illegal.status} ${illegal.body?.error?.code ?? ''})`,
);

// --- 9. The board ---------------------------------------------------------------
const board = await call('/restock/board');
console.log(`\n  9. Board loads                           ${ok(board.status === 200)} (${board.status})`);
if (board.status === 200) {
  for (const column of board.body.data.columns) {
    console.log(`      ${column.status.padEnd(10)} ${column.cards.length} card(s)`);
  }
}

// --- 10. The ledger reconciles ---------------------------------------------------
const lots = await prisma.stockLot.findMany({ where: { itemId: item.id } });
let reconciles = true;

for (const lot of lots) {
  const movements = await prisma.stockMovement.findMany({
    where: { lotId: lot.id },
    select: { direction: true, quantity: true },
  });

  const computed = movements.reduce((sum, m) => {
    if (m.direction === 'IN') return sum + m.quantity;
    if (m.direction === 'OUT') return sum - m.quantity;
    return sum + m.quantity; // TRANSFER and ADJUST are stored signed
  }, 0);

  if (computed !== lot.quantityOnHand) {
    reconciles = false;
    console.log(`      MISMATCH lot ${lot.id}: cached ${lot.quantityOnHand}, ledger ${computed}`);
  }
}

console.log(`\n  10. Every lot reconciles with its ledger ${ok(reconciles)}  (${lots.length} lots)`);

// --- Cleanup ---------------------------------------------------------------------
await prisma.restockLine.deleteMany({ where: { request: { note: 'RSTK flow check' } } });
await prisma.restockRequest.deleteMany({ where: { note: 'RSTK flow check' } });
await prisma.formSubmission.deleteMany({ where: { id: submission.body.data.id } });
await prisma.stockMovement.deleteMany({ where: { itemId: item.id } });
await prisma.stockLot.deleteMany({ where: { itemId: item.id } });
await prisma.item.delete({ where: { id: item.id } });
if (tqField) await prisma.formField.update({ where: { id: tqField.id }, data: { linkedItemId: null } });

console.log('\n  Cleaned up.\n');
await prisma.$disconnect();
