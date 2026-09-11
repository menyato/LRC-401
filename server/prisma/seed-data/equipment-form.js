/**
 * =============================================================================
 *  Seed data — "Ambulance Equipment Report"
 * =============================================================================
 *  This is your Monday Equipment Report, translated into the template format
 *  the form builder uses. It is SEED DATA, not code: once seeded, the super
 *  admin edits everything here from the dashboard — add a question, change a
 *  threshold, reorder a section — with no developer involved.
 *
 *  The thresholds below are STARTING GUESSES based on how the paper form is
 *  laid out (a question offering 0/1 almost certainly expects 1). Review them
 *  in the form builder before the first real shift.
 *
 *  Three small builders remove the repetition — the form has ~90 questions and
 *  writing each as a full literal would be thousands of near-identical lines.
 * =============================================================================
 */

// -----------------------------------------------------------------------------
//  Builders
// -----------------------------------------------------------------------------

/**
 * A "pick one number" question — the most common shape in your form.
 *
 * @param {string} key       Stable answer key. Never change it after go-live.
 * @param {string} en        English label.
 * @param {string} ar        Arabic label.
 * @param {Array}  choices   Selectable values, e.g. [0, 1] or [0,1,2,3,4,'5+'].
 * @param {number} [expected] What should be present. Becomes the threshold:
 *                            below it is amber, below 1 is red.
 */
const count = (key, en, ar, choices, expected) => ({
  key,
  labelEn: en,
  labelAr: ar,
  type: 'NUMBER_CHOICE',
  isRequired: true,
  config: {
    choices,
    ...(expected !== undefined
      ? { threshold: { expected, warnBelow: expected, criticalBelow: 1 } }
      : {}),
  },
});

/**
 * A matrix question: several named rows, each graded on its own threshold.
 * This is the shape your form uses for Airways, the AED pack, the red bags, etc.
 *
 * @param {Array<[string, string, string, number|undefined]>} rows
 *        [key, English label, Arabic label, expected]
 */
const grid = (key, en, ar, choices, rows) => ({
  key,
  labelEn: en,
  labelAr: ar,
  type: 'GRID',
  isRequired: true,
  config: {
    choices,
    rows: rows.map(([rowKey, rowEn, rowAr, expected]) => ({
      key: rowKey,
      labelEn: rowEn,
      labelAr: rowAr,
      ...(expected !== undefined
        ? { threshold: { expected, warnBelow: expected, criticalBelow: 1 } }
        : {}),
    })),
  },
});

/**
 * A qualitative choice where the ANSWER ITSELF carries the severity — used for
 * "Betadine content: empty to quarter", where there is no number to compare but
 * an almost-empty bottle is still a problem.
 *
 * @param {Array<[string, string, string, 'OK'|'WARN'|'CRITICAL']>} options
 */
const choice = (key, en, ar, options) => ({
  key,
  labelEn: en,
  labelAr: ar,
  type: 'SINGLE_SELECT',
  isRequired: true,
  config: {
    options: options.map(([value, optEn, optAr, severity = 'OK']) => ({
      value,
      labelEn: optEn,
      labelAr: optAr,
      severity,
    })),
  },
});

/** A free number, e.g. oxygen pressure in bar. */
const number = (key, en, ar, { min = 0, max = 300, unit, expected } = {}) => ({
  key,
  labelEn: en,
  labelAr: ar,
  type: 'NUMBER',
  isRequired: true,
  config: {
    min,
    max,
    ...(unit ? { unit } : {}),
    ...(expected !== undefined ? { threshold: { expected, warnBelow: expected } } : {}),
  },
});

/** Common choice ranges, named so the intent is readable at each call site. */
const ZERO_ONE = [0, 1];
const ZERO_TWO = [0, 1, 2];
const ZERO_THREE = [0, 1, 2, 3];
const ZERO_FOUR = [0, 1, 2, 3, 4];
const ZERO_FIVE_PLUS = [0, 1, 2, 3, 4, '5+'];

// -----------------------------------------------------------------------------
//  The template
// -----------------------------------------------------------------------------

export const ambulanceEquipmentForm = {
  key: 'ambulance_equipment_report',
  titleEn: 'Ambulance Equipment Report',
  titleAr: 'تقرير معدات السيارة',
  descriptionEn:
    'Official record of the equipment carried on this vehicle. Complete it at the start of your shift so shortages can be restocked the same day.',
  descriptionAr:
    'السجل الرسمي لمعدات هذه السيارة. يُرجى تعبئته في بداية الدوام ليتم تعويض النواقص في اليوم نفسه.',
  scope: 'AMBULANCE',

  sections: [
    // =========================================================================
    {
      key: 'transport',
      titleEn: 'Transport Equipment',
      titleAr: 'معدات النقل',
      fields: [
        grid('stretcher', 'Stretcher', 'المحمل', ZERO_FOUR, [
          ['stretcher', 'Stretcher', 'المحمل', 1],
          ['female_belts', 'Female Belts', 'أحزمة نسائية', 2],
          ['male_belts', 'Male Belts', 'أحزمة ذكرية', 2],
        ]),
        count('portable_stretcher', 'Portable Stretcher', 'محمل متحرك', ZERO_ONE, 1),
        count('transport_chair', 'Transport Chair', 'كرسي نقل', ZERO_ONE, 1),
        count('ez_glide', 'EZ-Glide', 'EZ-Glide', ZERO_ONE, 1),
        count('cpr_board', 'CPR Board', 'لوح صلب', ZERO_ONE, 1),
      ],
    },

    // =========================================================================
    {
      key: 'splinting',
      titleEn: 'Splinting and Immobilization Equipment',
      titleAr: 'معدات التجبير والتثبيت',
      fields: [
        grid('ked', 'Kendrick Extrication Device', 'جهاز كندريك للإخراج', ZERO_TWO, [
          ['ked', 'KED', 'KED', 1],
          ['pillow', 'Pillow', 'مخدة', 1],
        ]),
        count('spinal_board', 'Spinal Board', 'لوح تثبيت العامود الفقري', ZERO_ONE, 1),
        grid('spinal_attachments', 'Spinal Board Attachments', 'ملحقات لوح العمود الفقري', ZERO_TWO, [
          ['head_immobilizer', 'Head Immobilizer Base', 'قاعدة تثبيت الرأس', 1],
          ['pillow', 'Pillow', 'مخدة', 2],
          ['belts', 'Belts', 'أحزمة', 2],
        ]),
        count('scoop', 'Scoop', 'محمل سكوب', ZERO_ONE, 1),
        count('pelvic_belt', 'Pelvic Belt', 'حزام الحوض', ZERO_ONE, 1),
        grid('matlat', 'Matlat', 'Matlat', ZERO_ONE, [
          ['matlat', 'Matlat', 'Matlat', 1],
          ['pump', 'Pump', 'منفاخ', 1],
        ]),
        grid('yellow_splint_bag', 'Yellow Splint Bag', 'حقيبة جبائر صفراء', ZERO_TWO, [
          ['small', 'Small Splint', 'جبيرة صغيرة', 1],
          ['medium', 'Medium Splint', 'جبيرة متوسطة', 1],
          ['large', 'Large Splint', 'جبيرة كبيرة', 1],
        ]),
        grid('rigid_splints', 'Rigid Splints', 'جبائر صلبة', ZERO_TWO, [
          ['small', 'Small Splint', 'جبيرة صغيرة', 1],
          ['medium', 'Medium Splint', 'جبيرة متوسطة', 1],
          ['large', 'Large Splint', 'جبيرة كبيرة', 1],
        ]),
        grid('vacuum_splints', 'Vacuum Splints', 'جبائر فراغية', ZERO_TWO, [
          ['small', 'Small Splint', 'جبيرة صغيرة', 1],
          ['medium', 'Medium Splint', 'جبيرة متوسطة', 1],
          ['large', 'Large Splint', 'جبيرة كبيرة', 1],
          ['pump', 'Pump', 'منفاخ', 1],
        ]),
      ],
    },

    // =========================================================================
    {
      key: 'aed_pack',
      titleEn: 'AED Pack',
      titleAr: 'حزمة جهاز الصدمة الكهربائية',
      fields: [
        grid('aed', 'AED', 'جهاز الصدمة الكهربائية', ZERO_FOUR, [
          ['device', 'AED Device', 'جهاز الصدمة الكهربائية', 1],
          ['patches', 'Patches', 'لصقات', 2],
          ['blades', 'Blades', 'شفرات', 1],
          ['towels', 'Towels', 'مناشف', 1],
          ['battery', 'AED Battery', 'بطارية الجهاز', 1],
        ]),
      ],
    },

    // =========================================================================
    {
      key: 'medical_bag',
      titleEn: 'Medical Bag',
      titleAr: 'الحقيبة الطبية',
      fields: [
        count('portable_o2_tank', 'Portable Oxygen Tank', 'قنينة أكسجين متحركة', ZERO_TWO, 1),
        number('portable_o2_pressure', 'Oxygen Pressure', 'ضغط الأكسجين', {
          max: 300,
          unit: 'bar',
          // Below ~50 bar a cylinder is nearly empty and must be swapped.
          expected: 100,
        }),
        count('adult_simple_mask', 'Adult Simple Oxygen Mask', 'ماسك أكسجين كبير', ZERO_FIVE_PLUS, 2),
        count('pedi_simple_mask', 'Pediatric Simple Oxygen Mask', 'قناع أكسجين صغير', ZERO_FIVE_PLUS, 1),
        count('adult_nrb', 'Adult NRB', 'قناع مع كيس هواء كبير', ZERO_FIVE_PLUS, 2),
        count('pedi_nrb', 'Pediatric NRB', 'قناع مع كيس هواء صغير', ZERO_FIVE_PLUS, 1),
        count('adult_nasal', 'Adult Nasal Cannula', 'قنية أنفية للبالغين', ZERO_FIVE_PLUS, 2),
        count('pedi_nasal', 'Pediatric Nasal Cannula', 'قنية أنفية للصغار', ZERO_FIVE_PLUS, 1),
        count('manual_suction', 'Manual Suction Unit', 'جهاز الشفط اليدوي', ZERO_ONE, 1),
        count('manual_suction_tube', 'Manual Suction Tube', 'أنبوب الشفط اليدوي', ZERO_TWO, 1),
        count('ambu_large', 'Large Ambu Bag and Mask', 'حقيبة أمبو الكبيرة وقناعها', ZERO_ONE, 1),
        count('ambu_small', 'Small Ambu Bag and Mask', 'حقيبة أمبو الصغيرة وقناعها', ZERO_ONE, 1),
        grid('airways', 'Airways', 'قنية مجرى الهواء', ZERO_TWO, [
          ['blue_orange', 'Blue / Orange', 'أزرق / برتقالي', 1],
          ['red', 'Red', 'أحمر', 1],
          ['yellow', 'Yellow', 'أصفر', 1],
          ['green', 'Green', 'أخضر', 1],
          ['white', 'White', 'أبيض', 1],
        ]),
        grid('sphygmomanometer', 'Sphygmomanometer', 'مكنة ضغط', ZERO_TWO, [
          ['portable', 'Portable', 'متحرك', 1],
          ['stethoscope', 'Stethoscope', 'سماعة', 1],
        ]),
        count('pulse_oximeter', 'Pulse Oximeter', 'مقياس التأكسج', ZERO_ONE, 1),
        count('glucometer', 'Glucometer', 'مكنة السكري', ZERO_ONE, 1),
        grid(
          'glucometer_attachments',
          'Glucometer Attachments',
          'ملحقات مكنة السكري',
          [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          [
            ['needles', 'Needles', 'أبر', 5],
            ['strips', 'Strips', 'شرائط', 5],
          ],
        ),
        count('glucose_gel', 'Glucose Gel', 'جل الغلوكوز', ZERO_TWO, 1),
      ],
    },

    // =========================================================================
    {
      key: 'trauma_bag',
      titleEn: 'Trauma Bag',
      titleAr: 'حقيبة الصدمات',
      fields: [
        count('spider_belts', 'Spider Belts', 'أحزمة لوح التثبيت', ZERO_ONE, 1),
        count('ccollar_adult', 'C-collar Adult', 'طوق كبير', ZERO_ONE, 1),
        count('ccollar_pedi', 'C-collar Pediatric', 'طوق صغير', ZERO_ONE, 1),
        count('sam_chest_seal', 'Sam Chest Seal', 'لاصق الصدر', ZERO_THREE, 2),
        count('chito_sam', 'Chito SAM', 'Chito SAM', ZERO_TWO, 1),
        count('abdominal_bandage', 'Abdominal Bandage', 'ضماد البطن', ZERO_TWO, 1),
        count('filling_roll', 'Filling Roll', 'حشوات للفراغات', ZERO_TWO, 1),
        count('triangular_bandage', 'Triangular Bandage', 'منديل مثلث', ZERO_TWO, 2),
        number('gauze', 'Gauze', 'شاش', { max: 100, expected: 10 }),
        count('betadine', 'Betadine', 'بيتادين', ZERO_TWO, 1),
        choice('betadine_content', 'Betadine Content', 'محتوى البيتادين', [
          // The severity lives on the ANSWER, not on a number — an almost-empty
          // bottle is a shortage even though "1 bottle" is present.
          ['empty_quarter', 'Empty to Quarter', 'فارغة الى الربع', 'CRITICAL'],
          ['quarter_half', 'Quarter to Half', 'الربع الى النص', 'WARN'],
          ['more_than_half', 'More than Half', 'أكثر من النصف', 'OK'],
        ]),
        count('isothermal_blanket', 'Isothermal Blanket', 'شرشف حافظ للحرارة', ZERO_TWO, 2),
        number('fa_dressing', 'FA Dressing', 'ضماد ضاغط', { max: 50, expected: 4 }),
        count('adhesive_tape', 'Adhesive Tape', 'شريط لاصق', ZERO_THREE, 1),
        number('bandaid', 'Bandaid', 'بلاستر', { max: 100, expected: 10 }),
        count('tourniquet', 'Tourniquet', 'رباط ضاغط', ZERO_TWO, 2),
        grid('velpo', 'Velpo', 'رباط مطاطي', ZERO_FOUR, [
          ['small', 'Small', 'صغير', 2],
          ['medium', 'Medium', 'متوسط', 2],
          ['large', 'Large', 'كبير', 2],
        ]),
        count('scissor', 'Scissor', 'مقص', ZERO_TWO, 1),
        count('tweezer', 'Tweezer', 'ملقط', ZERO_TWO, 1),
        grid('speed_clips_belts', 'Speed Clips Belts', 'أحزمة تثبيت', ZERO_FOUR, [
          ['male', 'Male', 'ذكري', 2],
          ['female', 'Female', 'نسائي', 2],
        ]),
        grid('scoop_belts', 'Scoop Belts', 'أحزمة سكوب', ZERO_FOUR, [
          ['male', 'Male', 'ذكري', 2],
          ['female', 'Female', 'نسائي', 2],
        ]),
        count('ice_packs', 'Ice Packs', 'أكياس الثلج', ZERO_THREE, 2),
      ],
    },

    // =========================================================================
    {
      key: 'misc',
      titleEn: 'Miscellaneous Equipment',
      titleAr: 'معدات متنوعة',
      fields: [
        count('main_o2_tank', 'Main Oxygen Tank', 'قنينة أكسجين أساسية', ZERO_ONE, 1),
        number('main_o2_pressure', 'Oxygen Pressure', 'ضغط الأكسجين', {
          max: 300,
          unit: 'bar',
          expected: 100,
        }),
        grid('extra_o2_bottles', 'Extra Oxygen Bottles', 'قناني أكسجين زائدة', [0, 1, 2, '3+'], [
          ['portable', 'Portable', 'صغيرة', 1],
          ['medium', 'Medium', 'متوسطة', 1],
        ]),
        count('o2_respirator', 'Oxygen Respirator', 'جهاز تنفس بالأكسجين', ZERO_ONE, 1),
        count('respirator_kit', 'Respirator Kit', 'عدة جهاز التنفس', ZERO_ONE, 1),
        count('o2_regulator', 'Oxygen Regulator in Respirator', 'ساعة الأكسجين داخل جهاز التنفس', ZERO_ONE, 1),
        grid('electric_suction', 'Electric Suction', 'الشفط الكهربائي', [0, 1, 2, 3, 4, 5], [
          ['unit', 'Electric Suction Unit', 'جهاز الشفط الكهربائي', 1],
          ['catheters', 'Catheters', 'أنابيب قسطرة', 2],
        ]),
        count('red_bags_count', 'Small Red Bags Count', 'عدد الحقائب الحمراء الصغيرة', ZERO_THREE, 2),

        // The two red bags are identical checklists. They stay SEPARATE
        // questions because each physical bag is restocked on its own — merging
        // them would hide which bag is short.
        redBag('red_bag_1', 'Small Red Bag Number 1', 'حقيبة حمراء صغيرة رقم ١'),
        redBag('red_bag_2', 'Small Red Bag Number 2', 'حقيبة حمراء صغيرة رقم ٢'),

        grid('gloves_box', 'Gloves Boxes', 'علب القفازات', ZERO_TWO, [
          ['small', 'Small', 'صغير', 1],
          ['medium', 'Medium', 'متوسط', 1],
          ['large', 'Large', 'كبير', 1],
          ['xlarge', 'X-Large', 'كبير جداً', 1],
        ]),
        count('face_mask', 'Face Masks', 'كمامات', ZERO_THREE, 2),
        count('vomiting_bags', 'Vomiting Bags', 'أكياس استفراغ', [0, 1, 2, 3, 4, 5, 6], 3),
        choice('yellow_bags', 'Yellow Bags', 'أكياس صفر', [
          ['none', 'No Roll', 'لا يوجد', 'CRITICAL'],
          ['one', '1 Roll', 'لفة واحدة', 'WARN'],
          ['two', '2 Rolls', 'لفتان', 'OK'],
        ]),
        grid('urinary', 'Urinary', 'مبولة', ZERO_TWO, [
          ['male', 'Male Urinary', 'مبولة ذكرية', 1],
          ['female', 'Female Urinary', 'مبولة نسائية', 1],
        ]),
        grid('cleaning_tools', 'Cleaning Tools', 'أدوات التعقيم', ZERO_TWO, [
          ['descosept', 'Descosept', 'معقم لليدين', 1],
          ['cleanisept', 'Cleanisept', 'رشاشة تعقيم', 1],
          ['broom', 'Broom', 'مكنسة', 1],
          ['towel', 'Towel', 'منشفة', 1],
        ]),
        grid('ppe', 'Personal Protection Equipment', 'معدات الوقاية الشخصية', ZERO_TWO, [
          ['intermediate', 'Intermediate', 'متوسطة', 2],
          ['advanced', 'Advanced', 'متقدمة', 1],
        ]),
        count('body_bags', 'Body Bags', 'أكياس جثث', ZERO_FOUR, 2),
        count('flak_jackets', 'Flak Jackets', 'دروع', ZERO_FOUR, 2),
        count('helmets', 'Helmets', 'طاسات', ZERO_FOUR, 2),
        count('head_lamp', 'Head Lamp', 'ضوء رأس', ZERO_TWO, 1),
        count('vest', 'Vest', 'سترة', ZERO_TWO, 2),
        number('cones', 'Cones', 'مخاريط', { max: 20, expected: 2 }),
        count('warning_triangles', 'Warning Triangles', 'مثلثات تحذير', ZERO_TWO, 1),
        count('ob_kit', 'OB-Kit', 'عدة التوليد', ZERO_ONE, 1),
        count('mci_kit', 'MCI-Kit', 'عدة الإصابات الجماعية', ZERO_ONE, 1),
        number('disposable_blankets', 'Disposable Blankets', 'أغطية للاستعمال مرة واحدة', {
          max: 50,
          expected: 2,
        }),
        count('walkie_talkie', 'Walkie-Talkie', 'جهاز لاسلكي', ZERO_TWO, 1),
        count('walkie_battery', 'Walkie-Talkie Battery', 'بطارية الجهاز اللاسلكي', ZERO_THREE, 2),
        grid('charging_tools', 'Charging Tools', 'أدوات الشحن', ZERO_ONE, [
          ['adapter', 'Adapter', 'شاحن', 1],
          ['cable', 'Cable', 'كابل', 1],
        ]),
      ],
    },
  ],
};

/**
 * The red-bag checklist. Both bags carry the same 13 items, so the row list is
 * written once here rather than twice inline.
 */
function redBag(key, en, ar) {
  return grid(key, en, ar, [0, 1, 2, '3+'], [
    ['gloves', 'Gloves', 'قفازات', 2],
    ['high_risk_gloves', 'High Risk Gloves', 'قفازات عالية الخطورة', 1],
    ['mask', 'Mask', 'كمامات', 2],
    ['kn95', 'KN95 Mask', 'كمامات KN95', 1],
    ['fa_dressing', 'FA Dressing', 'ضماد ضاغط', 2],
    ['isothermal_blanket', 'Isothermal Blanket', 'شرشف حافظ للحرارة', 1],
    ['triangular_bandage', 'Triangular Bandage', 'منديل مثلث', 2],
    ['gauze', 'Gauze', 'شاش', 2],
    ['adhesive_tape', 'Adhesive Tape', 'شريط لاصق', 1],
    ['bandaid', 'Bandaid', 'بلاستر', 2],
    ['velpo', 'Velpo', 'رباط مطاطي', 1],
    ['airways', 'Airways', 'قنية مجرى الهواء', 1],
    ['scissors', 'Scissors', 'مقص', 1],
  ]);
}

/**
 * The ER Room uses the same engine with its own, shorter template.
 * Seeded as a starting point for the super admin to expand.
 */
export const erRoomEquipmentForm = {
  key: 'er_room_equipment_report',
  titleEn: 'ER Room Equipment Report',
  titleAr: 'تقرير معدات غرفة الإسعاف',
  descriptionEn: 'Daily check of the equipment held in the ER room.',
  descriptionAr: 'الفحص اليومي لمعدات غرفة الإسعافات.',
  scope: 'ER_ROOM',
  sections: [
    {
      key: 'er_core',
      titleEn: 'Core Equipment',
      titleAr: 'المعدات الأساسية',
      fields: [
        count('main_o2_tank', 'Main Oxygen Tank', 'قنينة أكسجين أساسية', ZERO_TWO, 1),
        number('main_o2_pressure', 'Oxygen Pressure', 'ضغط الأكسجين', { unit: 'bar', expected: 100 }),
        grid('aed', 'AED', 'جهاز الصدمة الكهربائية', ZERO_FOUR, [
          ['device', 'AED Device', 'الجهاز', 1],
          ['patches', 'Patches', 'لصقات', 2],
          ['battery', 'AED Battery', 'بطارية', 1],
        ]),
        count('automatic_suction', 'Automatic Suction', 'جهاز شفط آلي', ZERO_ONE, 1),
        grid('gloves_box', 'Gloves Boxes', 'علب القفازات', ZERO_TWO, [
          ['small', 'Small', 'صغير', 1],
          ['medium', 'Medium', 'متوسط', 1],
          ['large', 'Large', 'كبير', 1],
        ]),
        grid('cleaning_tools', 'Cleaning Tools', 'أدوات التعقيم', ZERO_TWO, [
          ['descosept', 'Descosept', 'معقم لليدين', 1],
          ['cleanisept', 'Cleanisept', 'رشاشة تعقيم', 1],
        ]),
      ],
    },
  ],
};
