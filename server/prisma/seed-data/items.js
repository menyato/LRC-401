/**
 * =============================================================================
 *  Seed data — the item list
 * =============================================================================
 *  Taken from your inventory spreadsheet, including its `Track Expiry? YES/NO`
 *  column, which maps directly onto `trackExpiry`.
 *
 *  This is a STARTING LIST, not the final one. Everything here is editable from
 *  the dashboard, and the rest of your sheet can be added the same way (or
 *  appended to this file and re-seeded — the seed is idempotent and matches on
 *  name, so re-running it will not create duplicates).
 *
 *  COLUMN MEANINGS
 *    trackExpiry  true  -> every receipt must carry a batch number + expiry
 *                          date, and the item appears on the expiry dashboard
 *    trackSize    true  -> stock is kept separately per size (clothing)
 *    sizes        the custom size list for that item — free text, so "S/M/L"
 *                 and "40/42/44" both work, as you asked
 * =============================================================================
 */

/**
 * Medical equipment and consumables.
 * Shape: [nameEn, nameAr | null, trackExpiry, unit]
 */
export const medicalItems = [
  // --- The one YES in the visible part of your sheet -------------------------
  ['Abdominal Bandage', 'ضماد البطن', true, 'piece'],

  // --- Airway & oxygen ------------------------------------------------------
  ['Adult Simple Oxygen Mask', 'ماسك أكسجين كبير', false, 'piece'],
  ['Airway Cannula 40mm', null, false, 'piece'],
  ['Airway Cannula 50mm', null, false, 'piece'],
  ['Airway Cannula 60mm', null, false, 'piece'],
  ['Airways 70 Inch White', 'قنية مجرى هواء أبيض', false, 'piece'],
  ['Airways 80 Inch Green', 'قنية مجرى هواء أخضر', false, 'piece'],
  ['Airways 90 Inch Yellow', 'قنية مجرى هواء أصفر', false, 'piece'],
  ['Airways 100 Inch Red', 'قنية مجرى هواء أحمر', false, 'piece'],
  ['Airways 110 Inch Blue', 'قنية مجرى هواء أزرق', false, 'piece'],
  ['Airways Pediatric', 'قنية مجرى هواء للأطفال', false, 'piece'],
  ['BVM Adult', 'حقيبة أمبو للبالغين', false, 'piece'],
  ['Breathing Circuit', null, false, 'piece'],
  ['Automatic Suction', 'جهاز شفط آلي', false, 'piece'],

  // --- AED ------------------------------------------------------------------
  ['AED', 'جهاز الصدمة الكهربائية', false, 'piece'],
  ['AED Lifepak 1000 Battery', 'بطارية جهاز الصدمة', false, 'piece'],
  ['AED Patches Quick Combo', 'لصقات جهاز الصدمة', false, 'pair'],

  // --- Immobilisation & transport ------------------------------------------
  ['Adult Cervical Collar', 'طوق رقبة للبالغين', false, 'piece'],
  ['CPR Board', 'لوح صلب', false, 'piece'],
  ['EZ-Glide', 'EZ-Glide', false, 'piece'],
  ['Extraction Pan', null, false, 'piece'],

  // --- Wound care & consumables --------------------------------------------
  ['Band Aid', 'بلاستر', false, 'piece'],
  ['Combat Gauze', 'شاش مرقئ', false, 'piece'],
  ['Compressive Bandage', 'ضماد ضاغط', false, 'piece'],
  ['Elastic Roll/Bande Velpo S', 'رباط مطاطي صغير', false, 'roll'],
  ['Elastic Roll/Bande Velpo M', 'رباط مطاطي متوسط', false, 'roll'],
  ['Elastic Roll/Bande Velpo L', 'رباط مطاطي كبير', false, 'roll'],
  ['Chest Seal', 'لاصق الصدر', false, 'piece'],
  ['Burn Kit', 'عدة الحروق', false, 'kit'],
  ['Burn Blanket', 'بطانية الحروق', false, 'piece'],
  ['Duct Tape', 'شريط لاصق قوي', false, 'roll'],

  // --- Antiseptics & disinfectants -----------------------------------------
  ['Betadine (250ml)', 'بيتادين ٢٥٠ مل', false, 'bottle'],
  ['Betadine (500ml)', 'بيتادين ٥٠٠ مل', false, 'bottle'],
  ['Cleanisept', 'رشاشة تعقيم', false, 'bottle'],
  ['Disinfectant for Instruments', 'معقم الأدوات', false, 'bottle'],
  ['Disinfectant Surface', 'معقم الأسطح', false, 'bottle'],
  ['Disinfectant Surface (1L)', 'معقم الأسطح ١ ليتر', false, 'bottle'],

  // --- Diagnostics ----------------------------------------------------------
  ['Electric Sphygmomanometer', 'مكنة ضغط كهربائية', false, 'piece'],
  ['Disposable Thermometer', 'ميزان حرارة للاستعمال مرة واحدة', false, 'piece'],

  // --- Protection & hygiene -------------------------------------------------
  ['Disposable Face Shield', 'واقي الوجه', false, 'piece'],
  ['Disposable Sheet/Blanket', 'شرشف للاستعمال مرة واحدة', false, 'piece'],
  ['Bed Pad / Alaise', null, false, 'piece'],
  ['Body Bag', 'كيس جثة', false, 'piece'],
  ['Female Urinary', 'مبولة نسائية', false, 'piece'],

  // --- Bags & vehicle kit ---------------------------------------------------
  ['EMT Leg Bag', 'حقيبة الساق', false, 'piece'],
  ['Car Triangle', 'مثلث تحذير', false, 'piece'],
  ['Dossar', null, false, 'piece'],
];

/**
 * Clothing and personal kit — issued to a named volunteer, tracked by size.
 * Shape: [nameEn, nameAr | null, sizes]
 *
 * Sizes are per item on purpose: shirts run S–XXL while boots run 39–46, and
 * forcing both onto one shared list would make every size dropdown wrong for
 * one of them.
 */
export const clothingItems = [
  ['Uniform Shirt', 'قميص البزة', ['S', 'M', 'L', 'XL', 'XXL']],
  ['Uniform Trousers', 'بنطلون البزة', ['S', 'M', 'L', 'XL', 'XXL']],
  ['Field Jacket', 'جاكيت ميداني', ['S', 'M', 'L', 'XL', 'XXL']],
  ['Rain Jacket', 'جاكيت مطر', ['S', 'M', 'L', 'XL', 'XXL']],
  ['Flak Jacket', 'درع واقي', ['S', 'M', 'L', 'XL']],
  ['Helmet', 'خوذة', ['S', 'M', 'L']],
  ['Safety Boots', 'حذاء أمان', ['39', '40', '41', '42', '43', '44', '45', '46']],
  ['Reflective Vest', 'سترة عاكسة', ['S', 'M', 'L', 'XL']],
  ['Winter Gloves', 'قفازات شتوية', ['S', 'M', 'L']],
  ['Cap', 'قبعة', ['One Size']],
];

/**
 * The two starting categories.
 *
 * `attributeDefs` are the extra fields the super admin can already edit from
 * the dashboard — seeded with a couple of useful examples so the feature is
 * visible and understood rather than an empty screen nobody discovers.
 */
export const categories = [
  {
    key: 'medical_equipment',
    nameEn: 'Medical Equipment',
    nameAr: 'المعدات الطبية',
    description: 'Consumables and devices carried on the vehicles and in the ER room.',
    icon: 'Stethoscope',
    attributeDefs: [
      {
        key: 'supplier',
        labelEn: 'Supplier',
        labelAr: 'المورّد',
        type: 'TEXT',
        showInList: false,
        sortOrder: 0,
      },
      {
        key: 'storage_location',
        labelEn: 'Storage Location',
        labelAr: 'مكان التخزين',
        type: 'TEXT',
        showInList: true,
        sortOrder: 1,
      },
    ],
  },
  {
    key: 'clothing',
    nameEn: 'Clothing & Personal Kit',
    nameAr: 'الألبسة والتجهيزات الشخصية',
    description: 'Uniforms and personal protective kit issued to volunteers by size.',
    icon: 'Shirt',
    attributeDefs: [
      {
        key: 'season',
        labelEn: 'Season',
        labelAr: 'الموسم',
        type: 'SELECT',
        options: ['All year', 'Summer', 'Winter'],
        showInList: true,
        sortOrder: 0,
      },
      {
        key: 'returnable',
        labelEn: 'Must be returned',
        labelAr: 'يجب إعادته',
        type: 'BOOLEAN',
        showInList: true,
        sortOrder: 1,
      },
    ],
  },
];

/** The station's vehicles, exactly as they appear on your report form. */
export const vehicles = [
  { code: '470', nameEn: 'Ambulance 470', nameAr: 'سيارة إسعاف ٤٧٠', kind: 'AMBULANCE' },
  { code: '471', nameEn: 'Ambulance 471', nameAr: 'سيارة إسعاف ٤٧١', kind: 'AMBULANCE' },
  { code: '472', nameEn: 'Ambulance 472', nameAr: 'سيارة إسعاف ٤٧٢', kind: 'AMBULANCE' },
  { code: '473', nameEn: 'Ambulance 473', nameAr: 'سيارة إسعاف ٤٧٣', kind: 'AMBULANCE' },
  { code: '474', nameEn: 'Ambulance 474', nameAr: 'سيارة إسعاف ٤٧٤', kind: 'AMBULANCE' },
  { code: '475', nameEn: 'Ambulance 475', nameAr: 'سيارة إسعاف ٤٧٥', kind: 'AMBULANCE' },
  { code: 'ER', nameEn: 'ER Room', nameAr: 'غرفة الإسعافات', kind: 'ER_ROOM' },
];

/**
 * The station's day teams: Monday to Friday.
 *
 * `dayOfWeek` follows the JavaScript convention (0 = Sunday … 6 = Saturday), so
 * Monday–Friday is 1–5. Weekend teams are deliberately NOT seeded — the station
 * does not run them.
 *
 * This is only a STARTING SET. Teams are ordinary database rows: the District
 * Equipment Chief can add a weekend team, a training cohort or a special-event
 * crew from Teams in the dashboard, with no code change. Nothing in the
 * application assumes there are exactly five, or that a team maps to a weekday
 * at all — `dayOfWeek` is nullable precisely so a non-day-based group is still
 * a valid team.
 */
export const teams = [
  { key: 'monday', nameEn: 'Monday Team', nameAr: 'فرقة الإثنين', dayOfWeek: 1 },
  { key: 'tuesday', nameEn: 'Tuesday Team', nameAr: 'فرقة الثلاثاء', dayOfWeek: 2 },
  { key: 'wednesday', nameEn: 'Wednesday Team', nameAr: 'فرقة الأربعاء', dayOfWeek: 3 },
  { key: 'thursday', nameEn: 'Thursday Team', nameAr: 'فرقة الخميس', dayOfWeek: 4 },
  { key: 'friday', nameEn: 'Friday Team', nameAr: 'فرقة الجمعة', dayOfWeek: 5 },
];
