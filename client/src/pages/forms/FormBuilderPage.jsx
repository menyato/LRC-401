/**
 * =============================================================================
 *  Form builder
 * =============================================================================
 *  Where the super admin edits the equipment report: sections, questions, and
 *  the THRESHOLDS that decide what counts as a shortage.
 *
 *  The whole template is held in local state and saved with a single PUT. The
 *  API replaces the structure wholesale, which is far simpler than diffing
 *  sections and fields — and reordering would rewrite every `sortOrder` anyway.
 *
 *  EDITING A PUBLISHED FORM CREATES A NEW VERSION. The API forks it into a
 *  draft and returns a different id, so the page redirects to the new one. That
 *  is what stops a threshold change from retroactively re-grading last month's
 *  reports.
 * =============================================================================
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ThresholdEditor } from '@/features/forms/ThresholdEditor';
import {
  Plus,
  Trash2,
  Pencil,
  Save,
  Upload,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

import { get, put, post } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { FullPageSpinner } from '@/components/Spinner';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';

/** Types the builder offers, matching the API's FieldType enum. */
const FIELD_TYPES = [
  'NUMBER_CHOICE',
  'GRID',
  'SINGLE_SELECT',
  'NUMBER',
  'TEXT',
  'BOOLEAN',
  'DATE',
  'SECTION_NOTE',
];

/** A blank question. NUMBER_CHOICE is by far the most common shape. */
const newField = (index) => ({
  key: `field_${Date.now()}_${index}`,
  labelEn: '',
  labelAr: '',
  type: 'NUMBER_CHOICE',
  isRequired: true,
  config: { choices: [0, 1], threshold: { expected: 1, warnBelow: 1, criticalBelow: 1 } },
});

const newSection = (index) => ({
  key: `section_${Date.now()}_${index}`,
  titleEn: '',
  titleAr: '',
  fields: [],
});

export default function FormBuilderPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState(null);
  const [openSection, setOpenSection] = useState(0);
  /**
   * Which question the editor dialog is showing, as {sectionIndex, fieldIndex}.
   * Null when the dialog is closed.
   */
  const [editing, setEditing] = useState(null);

  const { data: template, isLoading } = useQuery({
    queryKey: ['template', id],
    queryFn: () => get(`/forms/templates/${id}`),
  });

  // Copy the server's template into local state once it arrives. All editing
  // happens on this copy; nothing is sent until Save.
  useEffect(() => {
    if (template) setDraft(structuredClone(template));
  }, [template]);

  const save = useMutation({
    mutationFn: () =>
      put(`/forms/templates/${id}`, {
        titleEn: draft.titleEn,
        titleAr: draft.titleAr,
        descriptionEn: draft.descriptionEn,
        descriptionAr: draft.descriptionAr,
        scope: draft.scope,
        sections: draft.sections.map((section) => ({
          key: section.key,
          titleEn: section.titleEn,
          titleAr: section.titleAr,
          descriptionEn: section.descriptionEn ?? null,
          descriptionAr: section.descriptionAr ?? null,
          fields: section.fields.map((field) => ({
            key: field.key,
            labelEn: field.labelEn,
            labelAr: field.labelAr,
            helpEn: field.helpEn ?? null,
            helpAr: field.helpAr ?? null,
            type: field.type,
            isRequired: field.isRequired,
            config: field.config ?? {},
            linkedItemId: field.linkedItemId ?? null,
          })),
        })),
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });

      // The API forked a published template into a new draft version — follow
      // it, or the next save would edit the wrong record.
      if (updated.id !== id) {
        toast.success(t('forms.newVersion'));
        navigate(`/forms/${updated.id}`, { replace: true });
      } else {
        toast.success(t('common.save'));
        queryClient.invalidateQueries({ queryKey: ['template', id] });
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const publish = useMutation({
    mutationFn: () => post(`/forms/templates/${id}/publish`),
    onSuccess: () => {
      toast.success(t('forms.published'));
      queryClient.invalidateQueries({ queryKey: ['template', id] });
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (isLoading || !draft) return <FullPageSpinner />;

  /** Applies a change to one section, immutably. */
  const patchSection = (sectionIndex, changes) =>
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section, index) =>
        index === sectionIndex ? { ...section, ...changes } : section,
      ),
    }));

  /** Applies a change to one field inside one section. */
  const patchField = (sectionIndex, fieldIndex, changes) =>
    patchSection(sectionIndex, {
      fields: draft.sections[sectionIndex].fields.map((field, index) =>
        index === fieldIndex ? { ...field, ...changes } : field,
      ),
    });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={draft.titleEn || t('forms.builderTitle')}
        description={`${draft.key} · ${t('forms.version', { version: draft.version })}`}
      >
        <button
          type="button"
          className="btn-secondary"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {t('common.save')}
        </button>

        {draft.status === 'DRAFT' && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => publish.mutate()}
            disabled={publish.isPending}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {t('forms.publish')}
          </button>
        )}
      </PageHeader>

      {draft.status === 'PUBLISHED' && (
        <div
          className="mb-4 flex items-start gap-2 rounded-lg border border-status-warn/30
                     bg-status-warnBg p-3 text-sm text-status-warn"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('forms.publishedWarning')}
        </div>
      )}

      {/* ---------- Template details ---------- */}
      <div className="card mb-5">
        <div className="card-body grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="tpl-en" className="label">
              Title (EN)
            </label>
            <input
              id="tpl-en"
              className="input"
              value={draft.titleEn}
              onChange={(event) =>
                setDraft((current) => ({ ...current, titleEn: event.target.value }))
              }
            />
          </div>

          <div>
            <label htmlFor="tpl-ar" className="label">
              Title (AR)
            </label>
            <input
              id="tpl-ar"
              dir="rtl"
              className="input"
              value={draft.titleAr}
              onChange={(event) =>
                setDraft((current) => ({ ...current, titleAr: event.target.value }))
              }
            />
          </div>
        </div>
      </div>

      {/* ---------- Sections ---------- */}
      {draft.sections.map((section, sectionIndex) => {
        const isOpen = openSection === sectionIndex;

        return (
          <div key={section.key} className="card mb-3">
            <div className="card-header">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-start"
                onClick={() => setOpenSection(isOpen ? -1 : sectionIndex)}
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 flip-in-rtl" aria-hidden="true" />
                )}
                <span className="truncate text-sm font-semibold text-stone-800">
                  {section.titleEn || `Section ${sectionIndex + 1}`}
                </span>
                <span className="shrink-0 text-xs text-stone-400">
                  ({section.fields.length})
                </span>
              </button>

              <button
                type="button"
                className="btn-ghost btn-sm text-status-critical"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    sections: current.sections.filter((_, index) => index !== sectionIndex),
                  }))
                }
                aria-label={t('common.delete')}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {isOpen && (
              <div className="card-body">
                <div className="mb-4 grid gap-3 sm:grid-cols-2">
                  <input
                    className="input"
                    placeholder="Section title (EN)"
                    value={section.titleEn}
                    onChange={(event) =>
                      patchSection(sectionIndex, { titleEn: event.target.value })
                    }
                    aria-label="Section title (English)"
                  />
                  <input
                    className="input"
                    dir="rtl"
                    placeholder="عنوان القسم"
                    value={section.titleAr}
                    onChange={(event) =>
                      patchSection(sectionIndex, { titleAr: event.target.value })
                    }
                    aria-label="Section title (Arabic)"
                  />
                </div>

                {/*
                  QUESTIONS AS A LIST, NOT STACKED EDITORS.

                  Every question used to render its full editor inline. Across a
                  form of ~90 questions that is an unreadable wall: the settings
                  for one question run straight into the next with nothing to
                  mark where one ends, which is exactly the complaint.

                  Now each is a single row showing its name, type and rule at a
                  glance, separated by dividers. Clicking one opens a dialog with
                  the full editor. You can scan the section, and you only see the
                  detail for the question you are actually changing.
                */}
                <ul className="divide-y divide-surface-border rounded-lg border border-surface-border">
                  {section.fields.length === 0 && (
                    <li className="p-4 text-center text-sm text-stone-400">
                      {t('forms.noQuestionsYet')}
                    </li>
                  )}

                  {section.fields.map((field, fieldIndex) => (
                    <FieldRow
                      key={field.key}
                      field={field}
                      index={fieldIndex}
                      onEdit={() => setEditing({ sectionIndex, fieldIndex })}
                      onDelete={() =>
                        patchSection(sectionIndex, {
                          fields: section.fields.filter((_, index) => index !== fieldIndex),
                        })
                      }
                    />
                  ))}
                </ul>

                <button
                  type="button"
                  className="btn-secondary mt-3 w-full"
                  onClick={() => {
                    const fields = [...section.fields, newField(section.fields.length)];
                    patchSection(sectionIndex, { fields });
                    // Open the new question straight away — it is blank and
                    // needs a name before it means anything.
                    setEditing({ sectionIndex, fieldIndex: fields.length - 1 });
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t('forms.addQuestion')}
                </button>
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        className="btn-secondary w-full"
        onClick={() =>
          setDraft((current) => {
            const next = [...current.sections, newSection(current.sections.length)];
            // Open the new section immediately — it is empty and needs a title.
            setOpenSection(next.length - 1);
            return { ...current, sections: next };
          })
        }
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('forms.addSection')}
      </button>

      {/* ---------- One question's full editor ---------- */}
      {editing && (
        <FieldEditorModal
          field={draft.sections[editing.sectionIndex].fields[editing.fieldIndex]}
          onChange={(changes) => patchField(editing.sectionIndex, editing.fieldIndex, changes)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * One question as a single scannable row.
 *
 * Shows only what is needed to find the right question: its name, its type, and
 * a one-line summary of the rule. Everything else is behind the dialog.
 */
function FieldRow({ field, index, onEdit, onDelete }) {
  const { t } = useTranslation();
  const config = field.config ?? {};

  /** The rule, in the fewest words that still say something useful. */
  const ruleSummary = () => {
    if (field.type === 'GRID') {
      const rows = config.rows ?? [];
      const withRule = rows.filter((row) => row.threshold).length;
      const parts = [t('forms.rowCount', { count: rows.length })];

      if (withRule > 0) parts.push(t('forms.rowsWithRule', { count: withRule }));
      if (config.groupThreshold?.expected !== undefined) {
        parts.push(t('forms.totalRule', { count: config.groupThreshold.expected }));
      }
      return parts.join(' · ');
    }

    if (config.threshold?.expected !== undefined) {
      return t('forms.needsCount', { count: config.threshold.expected });
    }

    if (field.type === 'SINGLE_SELECT') {
      return t('forms.optionCount', { count: (config.options ?? []).length });
    }

    return t('forms.noRuleSet');
  };

  const priority = config.priority ?? 'NORMAL';

  return (
    <li>
      <div className="flex items-center gap-2 p-2.5 hover:bg-stone-50">
        <span className="w-6 shrink-0 text-xs tabular-nums text-stone-400">{index + 1}</span>

        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-start"
          aria-label={`${t('common.edit')}: ${field.labelEn || field.key}`}
        >
          <span className="block truncate text-sm font-medium text-stone-800">
            {field.labelEn || <span className="text-stone-400">{t('forms.untitledQuestion')}</span>}
          </span>
          <span className="block truncate text-xs text-stone-500">
            {t(`forms.type.${field.type}`, field.type)} · {ruleSummary()}
            {!field.isRequired && ` · ${t('common.optional')}`}
          </span>
        </button>

        {/* Only shown when it differs from the default — a row of "Normal"
            badges would be noise on every question. */}
        {priority !== 'NORMAL' && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              priority === 'URGENT' || priority === 'HIGH'
                ? 'bg-status-criticalBg text-status-critical'
                : 'bg-stone-100 text-stone-500'
            }`}
          >
            {t(`priority.${priority}`)}
          </span>
        )}

        <button
          type="button"
          className="btn-ghost btn-sm shrink-0"
          onClick={onEdit}
          aria-label={t('common.edit')}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          className="btn-ghost btn-sm shrink-0 text-status-critical"
          onClick={onDelete}
          aria-label={t('common.delete')}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/** The full editor for one question, in a dialog. */
function FieldEditorModal({ field, onChange, onClose }) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={field.labelEn || t('forms.editQuestion')}
      size="lg"
      footer={
        <button type="button" className="btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      {/*
        Edits apply to the draft immediately, so there is no Save/Cancel inside
        this dialog — the page's own Save is the only commit point. Two levels
        of saving would leave people unsure which one actually mattered.
      */}
      <FieldEditor field={field} onChange={onChange} />
    </Modal>
  );
}

/** One question, with its type-specific configuration and thresholds. */
function FieldEditor({ field, onChange }) {
  const { t } = useTranslation();
  const config = field.config ?? {};

  const patchConfig = (changes) => onChange({ config: { ...config, ...changes } });

  const patchThreshold = (changes) =>
    patchConfig({ threshold: { ...(config.threshold ?? {}), ...changes } });

  return (
    <div className="rounded-lg border border-surface-border p-3">
      {/*
        No delete button here: the question list owns deletion, so there is one
        obvious place to remove a question rather than two.
      */}
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <input
          className="input"
          placeholder={`${t('forms.questionLabel')} (EN)`}
          value={field.labelEn}
          onChange={(event) => onChange({ labelEn: event.target.value })}
          aria-label={`${t('forms.questionLabel')} (English)`}
        />
        <input
          className="input"
          dir="rtl"
          placeholder="السؤال"
          value={field.labelAr}
          onChange={(event) => onChange({ labelAr: event.target.value })}
          aria-label={`${t('forms.questionLabel')} (Arabic)`}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <label className="label text-xs">{t('forms.questionType')}</label>
          <select
            className="input"
            value={field.type}
            onChange={(event) => onChange({ type: event.target.value })}
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`fieldTypes.${type}`)}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-end gap-2 pb-2.5 text-sm text-stone-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-surface-border text-brand-600"
            checked={field.isRequired}
            onChange={(event) => onChange({ isRequired: event.target.checked })}
          />
          {t('forms.required')}
        </label>
      </div>

      {/* ---------- Choices, for the count-style questions ---------- */}
      {['NUMBER_CHOICE', 'GRID'].includes(field.type) && (
        <div className="mt-3">
          <label className="label text-xs">{t('forms.choices')}</label>
          <input
            className="input"
            // A comma-separated list is the fastest way to type "0,1,2,5+".
            value={(config.choices ?? []).join(', ')}
            onChange={(event) =>
              patchConfig({
                choices: event.target.value
                  .split(',')
                  .map((entry) => entry.trim())
                  .filter(Boolean)
                  // Keep "5+" as text, turn "2" into a number — the threshold
                  // engine understands both.
                  .map((entry) => (/^\d+$/.test(entry) ? Number(entry) : entry)),
              })
            }
            placeholder="0, 1, 2, 5+"
          />
        </div>
      )}

      {/* ---------- Grid rows, each with its own threshold ---------- */}
      {field.type === 'GRID' && (
        <div className="mt-3">
          <label className="label text-xs">{t('forms.rows')}</label>

          <div className="space-y-2">
            {(config.rows ?? []).map((row, rowIndex) => (
              <div key={row.key} className="flex flex-wrap items-center gap-2">
                <input
                  className="input flex-1 min-w-[8rem]"
                  placeholder="Row label (EN)"
                  value={row.labelEn}
                  onChange={(event) =>
                    patchConfig({
                      rows: config.rows.map((entry, index) =>
                        index === rowIndex ? { ...entry, labelEn: event.target.value } : entry,
                      ),
                    })
                  }
                  aria-label="Row label (English)"
                />
                <input
                  className="input flex-1 min-w-[8rem]"
                  dir="rtl"
                  placeholder="اسم الصف"
                  value={row.labelAr ?? ''}
                  onChange={(event) =>
                    patchConfig({
                      rows: config.rows.map((entry, index) =>
                        index === rowIndex ? { ...entry, labelAr: event.target.value } : entry,
                      ),
                    })
                  }
                  aria-label="Row label (Arabic)"
                />
                <input
                  type="number"
                  className="input w-20"
                  placeholder={t('forms.expected')}
                  value={row.threshold?.expected ?? ''}
                  onChange={(event) => {
                    const expected = event.target.value === '' ? undefined : Number(event.target.value);

                    patchConfig({
                      rows: config.rows.map((entry, index) =>
                        index === rowIndex
                          ? {
                              ...entry,
                              // Setting "expected" fills in sensible warn and
                              // critical levels, so the common case is one
                              // number rather than three.
                              threshold:
                                expected === undefined
                                  ? undefined
                                  : { expected, warnBelow: expected, criticalBelow: 1 },
                            }
                          : entry,
                      ),
                    });
                  }}
                  aria-label={t('forms.expected')}
                />
                <button
                  type="button"
                  className="btn-ghost btn-sm text-status-critical"
                  onClick={() =>
                    patchConfig({ rows: config.rows.filter((_, index) => index !== rowIndex) })
                  }
                  aria-label={t('common.delete')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn-secondary btn-sm mt-2"
            onClick={() =>
              patchConfig({
                rows: [
                  ...(config.rows ?? []),
                  {
                    key: `row_${Date.now()}`,
                    labelEn: '',
                    labelAr: '',
                    threshold: { expected: 1, warnBelow: 1, criticalBelow: 1 },
                  },
                ],
              })
            }
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('forms.addRow')}
          </button>
        </div>
      )}

      {/* ---------- Threshold, for non-grid numeric questions ---------- */}
      {/*
        One number plus a live preview, rather than three raw inputs whose
        relationship you had to already know. See ThresholdEditor for why.
      */}
      {['NUMBER_CHOICE', 'NUMBER'].includes(field.type) && (
        <div className="mt-3">
          <ThresholdEditor
            label={t('forms.thresholds')}
            threshold={config.threshold}
            choices={config.choices}
            onChange={(threshold) => patchConfig({ threshold })}
          />
        </div>
      )}

      {/* ---------- Group threshold, for GRID questions ---------- */}
      {/*
        Judges the rows TOGETHER rather than one by one.

        This is what expresses "at least 2 boxes of gloves in total, whichever
        sizes". Per-row thresholds cannot say that — they would either demand 2
        of EVERY size (far too strict) or accept 2 smalls and no larges (not
        what was meant).

        Per-row and group rules compose: a question can have both, and each
        raises its own issue. "One of every size AND four in total" is a
        perfectly sensible rule, and it is expressible here.
      */}
      {field.type === 'GRID' && (
        <div className="mt-3 rounded-lg bg-stone-50 p-2">
          <label className="mb-2 flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-stone-300 text-brand-600"
              checked={Boolean(config.groupThreshold)}
              onChange={(event) =>
                patchConfig({
                  groupThreshold: event.target.checked
                    ? { expected: 2, warnBelow: 2, criticalBelow: 1 }
                    : undefined,
                })
              }
            />
            <span>
              <span className="block text-xs font-medium text-stone-700">
                {t('forms.groupThreshold')}
              </span>
              <span className="block text-xs text-stone-500">{t('forms.groupThresholdHelp')}</span>
            </span>
          </label>

          {config.groupThreshold && (
            <div className="ps-6">
              <ThresholdEditor
                threshold={config.groupThreshold}
                onChange={(groupThreshold) => patchConfig({ groupThreshold })}
                // The preview runs over plausible TOTALS across all the rows,
                // not the per-row choices — "2 boxes of gloves altogether" is a
                // different scale from "0/1/2 of each size".
                choices={[0, 1, 2, 3, 4, 6, 8]}
                compact
              />
            </div>
          )}
        </div>
      )}

      {/* ---------- Priority ---------- */}
      {/*
        SEPARATE FROM SEVERITY, deliberately.

        Severity is computed from the day's numbers — how far below the
        threshold this came in. Priority is a standing judgement about how much
        the item matters, made once, here.

        A vehicle short one tourniquet and short one vomit bag are both
        "critical" by the numbers. They are not the same problem, and priority
        is what puts the tourniquet at the top of the restock board.
      */}
      {field.type !== 'SECTION_NOTE' && (
        <div className="mt-3">
          <label htmlFor={`priority-${field.key}`} className="label text-xs">
            {t('priority.label')}
          </label>
          <select
            id={`priority-${field.key}`}
            className="input"
            value={config.priority ?? 'NORMAL'}
            onChange={(event) =>
              patchConfig({
                // NORMAL is the default, so storing it would be noise in every
                // config blob.
                priority: event.target.value === 'NORMAL' ? undefined : event.target.value,
              })
            }
          >
            {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((level) => (
              <option key={level} value={level}>
                {t(`priority.${level}`)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">{t('priority.help')}</p>
        </div>
      )}
    </div>
  );
}
