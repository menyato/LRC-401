/**
 * =============================================================================
 *  Permission catalogue
 * =============================================================================
 *  This file is the COMPLETE list of things a person can be allowed to do.
 *
 *  Why a fixed list in code, when the brief says the super admin must be able
 *  to grant access dynamically?
 *
 *      Roles are dynamic. Permissions are not.
 *
 *  A permission string only means something because a route somewhere calls
 *  `requirePermission('inventory.item:create')`. If the dashboard could invent
 *  new permission strings, it would create checkboxes that guard nothing — an
 *  admin would believe they had restricted something when they had not. That
 *  is worse than no permission system at all.
 *
 *  So: the super admin freely composes these strings into named Roles (database
 *  rows) and can grant/deny individual strings per user. Adding a genuinely new
 *  capability means adding a line here AND enforcing it on a route — one commit,
 *  reviewed together.
 *
 *  NAMING: `resource:action` , with an optional `.scope` suffix on reads.
 *          Scope suffixes answer "whose records?", not "may you read?".
 * =============================================================================
 */

/**
 * The catalogue, grouped for the role editor UI.
 * `group` renders as a card; `label` is what the super admin actually reads,
 * so it is written in plain language, not jargon.
 */
export const PERMISSION_GROUPS = [
  {
    key: 'people',
    labelEn: 'People & Access',
    labelAr: 'الأشخاص والصلاحيات',
    permissions: [
      { key: 'user:read', labelEn: 'View user accounts', labelAr: 'عرض الحسابات' },
      { key: 'user:invite', labelEn: 'Invite new users by email', labelAr: 'دعوة مستخدمين جدد' },
      { key: 'user:update', labelEn: 'Edit user profiles', labelAr: 'تعديل الحسابات' },
      {
        key: 'user:manage_access',
        labelEn: 'Change a user’s role and permissions',
        labelAr: 'تغيير الدور والصلاحيات',
        // Anyone with this can escalate others; flagged so the UI warns.
        sensitive: true,
      },
      { key: 'user:suspend', labelEn: 'Suspend or reactivate users', labelAr: 'تعليق أو تفعيل الحسابات' },
      { key: 'role:read', labelEn: 'View roles', labelAr: 'عرض الأدوار' },
      {
        key: 'role:manage',
        labelEn: 'Create and edit roles',
        labelAr: 'إنشاء وتعديل الأدوار',
        sensitive: true,
      },
    ],
  },
  {
    key: 'org',
    labelEn: 'Teams & Vehicles',
    labelAr: 'الفرق والسيارات',
    permissions: [
      { key: 'team:read', labelEn: 'View teams', labelAr: 'عرض الفرق' },
      { key: 'team:manage', labelEn: 'Create and edit teams and members', labelAr: 'إدارة الفرق وأعضائها' },
      { key: 'vehicle:read', labelEn: 'View vehicles and ER room', labelAr: 'عرض السيارات وغرفة الإسعاف' },
      { key: 'vehicle:manage', labelEn: 'Create and edit vehicles', labelAr: 'إدارة السيارات' },
      {
        key: 'vehicle.rules:manage',
        // Changing what counts as a shortage for one vehicle affects every
        // future report it files, so it is its own right rather than folded
        // into ordinary vehicle editing.
        labelEn: 'Set per-vehicle exceptions to the report rules',
        labelAr: 'تحديد استثناءات قواعد التقرير لكل سيارة',
        sensitive: true,
      },
      { key: 'assignment:read.team', labelEn: 'View shift assignments for my teams', labelAr: 'عرض تعيينات فرقي' },
      { key: 'assignment:read.all', labelEn: 'View all shift assignments', labelAr: 'عرض كل التعيينات' },
      { key: 'assignment:manage', labelEn: 'Create and edit shift assignments', labelAr: 'إدارة التعيينات' },
    ],
  },
  {
    key: 'inventory',
    labelEn: 'Inventory (clothing & equipment)',
    labelAr: 'المستودع (ألبسة ومعدات)',
    permissions: [
      { key: 'inventory.item:read', labelEn: 'View the item list and stock levels', labelAr: 'عرض قائمة المواد والكميات' },
      { key: 'inventory.item:create', labelEn: 'Add new items', labelAr: 'إضافة مواد' },
      { key: 'inventory.item:update', labelEn: 'Edit items (sizes, expiry tracking, thresholds)', labelAr: 'تعديل المواد' },
      { key: 'inventory.item:delete', labelEn: 'Deactivate items', labelAr: 'إلغاء تفعيل المواد' },
      { key: 'inventory.movement:read', labelEn: 'View the in/out log', labelAr: 'عرض سجل الإدخال والإخراج' },
      { key: 'inventory.movement:create', labelEn: 'Record stock in / out', labelAr: 'تسجيل إدخال وإخراج' },
      { key: 'inventory.movement:adjust', labelEn: 'Correct stock after a physical count', labelAr: 'تصحيح الكميات بعد الجرد' },
      {
        key: 'inventory.movement:transfer',
        labelEn: 'Move stock between store, cabinet and vehicles',
        labelAr: 'نقل المخزون بين المستودع والخزانة والسيارات',
      },
      {
        key: 'inventory.location:manage',
        labelEn: 'Add and edit storage locations',
        labelAr: 'إدارة أماكن التخزين',
        sensitive: true,
      },
      {
        key: 'inventory.category:manage',
        labelEn: 'Change categories and the tracked fields',
        labelAr: 'تعديل الفئات والحقول المتتبَّعة',
        sensitive: true,
      },
    ],
  },
  {
    key: 'reports',
    labelEn: 'Equipment reports',
    labelAr: 'تقارير المعدات',
    permissions: [
      { key: 'submission:create', labelEn: 'Fill in an equipment report', labelAr: 'تعبئة تقرير المعدات' },
      { key: 'submission:read.own', labelEn: 'View only my own reports', labelAr: 'عرض تقاريري فقط' },
      { key: 'submission:read.team', labelEn: 'View reports of the teams I lead', labelAr: 'عرض تقارير فرقي' },
      { key: 'submission:read.all', labelEn: 'View all reports, every team', labelAr: 'عرض كل التقارير' },
      { key: 'submission:review', labelEn: 'Mark reports as reviewed and add notes', labelAr: 'مراجعة التقارير' },
      { key: 'submission:export', labelEn: 'Export reports to CSV', labelAr: 'تصدير التقارير' },
      { key: 'form.template:read', labelEn: 'View report templates', labelAr: 'عرض نماذج التقارير' },
      // --- Restock board ---------------------------------------------------
      {
        key: 'restock:read',
        labelEn: 'View the restock board',
        labelAr: 'عرض لوحة التعبئة',
      },
      {
        key: 'restock:create',
        labelEn: 'Raise a restock job from a report',
        labelAr: 'إنشاء طلب تعبئة من تقرير',
      },
      {
        key: 'restock:assign',
        labelEn: 'Assign restock jobs to a person',
        labelAr: 'تعيين طلبات التعبئة',
      },
      {
        key: 'restock:prepare',
        labelEn: 'Gather the items and set them aside for the crew',
        labelAr: 'تجهيز المواد وتحضيرها للفرقة',
      },
      {
        key: 'restock:confirm',
        // The step that actually MOVES STOCK — the crew attesting the items are
        // in their vehicle. Separate from preparing on purpose: the person who
        // set the items aside is not the person who confirms they arrived.
        labelEn: 'Confirm the items are loaded (moves stock to the vehicle)',
        labelAr: 'تأكيد تحميل المواد (ينقل المخزون إلى السيارة)',
      },
      {
        key: 'form.template:manage',
        labelEn: 'Build report forms and set thresholds',
        labelAr: 'بناء النماذج وتحديد الحدود',
        sensitive: true,
      },
    ],
  },
  {
    key: 'station',
    labelEn: 'Station administration',
    labelAr: 'إدارة المركز',
    permissions: [
      { key: 'dashboard:view', labelEn: 'Open the dashboard', labelAr: 'فتح لوحة التحكم' },
      { key: 'stats:view', labelEn: 'View statistics and charts', labelAr: 'عرض الإحصائيات' },
      { key: 'audit:read', labelEn: 'Read the activity log', labelAr: 'قراءة سجل النشاطات' },
      {
        key: 'settings:manage',
        labelEn: 'Change station settings',
        labelAr: 'تعديل إعدادات المركز',
        sensitive: true,
      },
    ],
  },
];

/**
 * Flat lookup: every valid permission string.
 * Used by the Zod validators so a typo in a role definition is rejected at the
 * API boundary instead of quietly creating a permission nobody has.
 */
export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.key),
);

/** Fast membership test — Set lookup instead of Array.includes in hot paths. */
const PERMISSION_SET = new Set(ALL_PERMISSIONS);

/** @returns {boolean} true when `key` is a real, enforceable permission. */
export const isValidPermission = (key) => PERMISSION_SET.has(key);

/**
 * The three read-scopes for equipment reports, widest last.
 * Order matters: `resolveScope()` picks the widest scope a user holds.
 */
export const SUBMISSION_SCOPES = ['own', 'team', 'all'];

/**
 * Roles created by the seed. The super admin can edit or extend these from the
 * dashboard — they are only a sensible starting point, not a hard-coded system.
 *
 * `isSystem: true` prevents DELETION (not editing), so the station can never
 * end up with no way to file a report.
 */
export const SEED_ROLES = [
  {
    key: 'field_responder',
    nameEn: 'EMT / First Responder',
    nameAr: 'مسعف / مستجيب أول',
    description: 'Fills in the equipment report for the vehicle they are assigned to.',
    isSystem: true,
    permissions: [
      'dashboard:view',
      'submission:create',
      'submission:read.own',
      'assignment:read.team',
      'team:read',
      'vehicle:read',
      'form.template:read',
      // Sees what is coming to their vehicle, and confirms it arrived.
      'restock:read',
      'restock:confirm',
    ],
  },
  {
    /**
     * The station's deputy. Broad access, but NOT the `isSuperAdmin` flag —
     * so they cannot create or demote another chief, and cannot reset an
     * account's password to a value they know.
     *
     * That distinction is the point: it is a genuine deputy rather than a
     * second person with unlimited control, and everything they do stays
     * attributable to them in the audit log.
     */
    key: 'co_district_equipment_chief',
    nameEn: 'Co-District Equipment Chief',
    nameAr: 'نائب رئيس معدات المنطقة',
    description:
      'Deputy to the District Equipment Chief. Full oversight of equipment, reports and teams across every team, but cannot create or remove another chief.',
    isSystem: true,
    permissions: [
      'dashboard:view',
      'stats:view',
      // Station-wide view of every team's reports.
      'submission:create',
      'submission:read.own',
      'submission:read.team',
      'submission:read.all',
      'submission:review',
      'submission:export',
      // Runs the report forms and their thresholds.
      'form.template:read',
      'form.template:manage',
      // Both stores.
      'inventory.item:read',
      'inventory.item:create',
      'inventory.item:update',
      'inventory.item:delete',
      'inventory.movement:read',
      'inventory.movement:create',
      'inventory.movement:adjust',
      'inventory.movement:transfer',
      'inventory.category:manage',
      'inventory.location:manage',
      'restock:read',
      'restock:create',
      'restock:assign',
      'restock:prepare',
      'restock:confirm',
      // Org structure.
      'team:read',
      'team:manage',
      'vehicle:read',
      'vehicle:manage',
      'vehicle.rules:manage',
      'assignment:read.team',
      'assignment:read.all',
      'assignment:manage',
      // People — can see and invite, but NOT change roles or suspend accounts.
      'user:read',
      'user:invite',
      'audit:read',
    ],
  },
  {
    key: 'team_admin',
    nameEn: 'Team Equipment Officer',
    nameAr: 'مسؤول معدات الفرقة',
    description:
      'Responsible for the equipment of one day team. Sees only their own team’s reports, rosters its crews, and acts on shortages.',
    isSystem: true,
    permissions: [
      'dashboard:view',
      'stats:view',
      'submission:create',
      'submission:read.own',
      'submission:read.team',
      'submission:review',
      'submission:export',
      'assignment:read.team',
      'assignment:manage',
      'team:read',
      'vehicle:read',
      'form.template:read',
      'inventory.item:read',
      'inventory.movement:read',
      // Runs the restock loop for their own team.
      'restock:read',
      'restock:create',
      'restock:assign',
      'restock:prepare',
      'restock:confirm',
    ],
  },
  {
    key: 'equipment_admin',
    nameEn: 'Equipment Admin',
    nameAr: 'مسؤول المعدات',
    description: 'Runs the medical equipment store: stock in/out, batches and expiry.',
    isSystem: true,
    permissions: [
      'dashboard:view',
      'stats:view',
      'inventory.item:read',
      'inventory.item:create',
      'inventory.item:update',
      'inventory.movement:read',
      'inventory.movement:create',
      'inventory.movement:adjust',
      'inventory.movement:transfer',
      'restock:read',
      'restock:prepare',
      'submission:read.all',
      'team:read',
      'vehicle:read',
    ],
  },
  {
    key: 'clothing_admin',
    nameEn: 'Clothing Admin',
    nameAr: 'مسؤول الألبسة',
    description: 'Runs the clothing store: issuing uniforms by size and tracking returns.',
    isSystem: true,
    permissions: [
      'dashboard:view',
      'stats:view',
      'inventory.item:read',
      'inventory.item:create',
      'inventory.item:update',
      'inventory.movement:read',
      'inventory.movement:create',
      'inventory.movement:adjust',
      'inventory.movement:transfer',
      'restock:read',
      'restock:prepare',
      'user:read',
      'team:read',
    ],
  },
];
