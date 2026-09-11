/**
 * =============================================================================
 *  Fill in an equipment report
 * =============================================================================
 *  The screen an EMT uses at the start of a shift. It renders whatever the
 *  super admin published — around 90 questions across six sections — and must
 *  stay usable on a phone.
 *
 *  THREE THINGS THAT MAKE A 90-QUESTION FORM WORKABLE:
 *
 *  1. SECTION AT A TIME. Showing all 90 at once produces a page nobody can
 *     navigate and a scroll position that is lost on every re-render.
 *  2. AUTOSAVE AS A DRAFT. Crews get called out mid-check. Losing twenty
 *     answers to an emergency is how a system stops being used.
 *  3. VISIBLE PROGRESS per section, so it is obvious what is left.
 *
 *  Answers live in ONE `answers` object keyed by field key — the same shape the
 *  API stores. No transformation on save, and no chance of the two drifting.
 * =============================================================================
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { Save, Send, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';

import { get, post } from '@/lib/api';
import { useAuth } from '@/features/auth/AuthProvider';
import { useLocalised } from '@/hooks/useLocalised';
import { useToast } from '@/components/Toast';
import { PageHeader } from '@/components/PageHeader';
import { FullPageSpinner, Spinner } from '@/components/Spinner';
import { FieldRenderer } from '@/features/reports/FieldRenderer';

export default function ReportFillPage() {
  const { t } = useTranslation();
  const L = useLocalised();
  const toast = useToast();
  const navigate = useNavigate();
  const { teams, canAny } = useAuth();

  // --- Which report are we filling? -----------------------------------------
  const [vehicleId, setVehicleId] = useState('');
  // A supervisor (District Chief / deputy) belongs to no team, so there is no
  // sensible default for them — they choose. Crew default to their own team.
  const [teamId, setTeamId] = useState(teams.memberOf[0] ?? '');
  const [shiftDate, setShiftDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [secondPersonName, setSecondPersonName] = useState('');

  /**
   * Kind of the chosen vehicle (AMBULANCE / ER_ROOM), which selects the
   * template. Held in state because a responder never loads the vehicle list —
   * it comes from their assignment instead. Without this an EMT rostered on the
   * ER Room would silently be handed the 85-question ambulance form.
   */
  const [vehicleKind, setVehicleKind] = useState(null);

  const [answers, setAnswers] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [sectionIndex, setSectionIndex] = useState(0);

  // --- Reference data --------------------------------------------------------
  /**
   * A responder fills in the report for the vehicle they were ROSTERED ON, and
   * nothing else. So the form is driven by their own assignments rather than by
   * a free choice of any vehicle in the station.
   *
   * This is not only a permission matter — the API refuses a submission from
   * someone who is not on that shift (NOT_ASSIGNED). Offering a picker full of
   * vehicles they cannot file for produced a confusing 403 at the very end,
   * after they had answered ninety questions.
   *
   * Team admins and the super admin keep the free picker: they legitimately
   * file and correct reports for vehicles they were not personally on.
   */
  const canPickAnyVehicle = canAny(['submission:read.team', 'submission:read.all']);

  const { data: myAssignments = [] } = useQuery({
    queryKey: ['assignments', 'mine'],
    queryFn: () =>
      get('/assignments/mine', {
        params: {
          // Yesterday onwards, so a shift that ran past midnight — or one the
          // crew did not get to file before going home — is still reachable.
          dateFrom: dayjs().subtract(2, 'day').format('YYYY-MM-DD'),
          dateTo: dayjs().add(7, 'day').format('YYYY-MM-DD'),
        },
      }),
  });

  // `get()` already unwraps the `{ data, meta }` envelope, so these resolve to
  // plain arrays. Only fetched for the people who may choose freely.
  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles', 'active'],
    queryFn: () => get('/vehicles', { params: { limit: 100 } }),
    enabled: canPickAnyVehicle,
  });

  const { data: myTeams = [] } = useQuery({
    queryKey: ['teams', 'all'],
    queryFn: () => get('/teams', { params: { limit: 50 } }),
    enabled: canPickAnyVehicle,
  });

  /** Applies one assignment to the form, fixing vehicle, team and date. */
  const chooseAssignment = (assignment) => {
    setVehicleId(assignment.vehicle.id);
    setTeamId(assignment.team.id);
    setVehicleKind(assignment.vehicle.kind);
    setShiftDate(dayjs(assignment.shiftDate).format('YYYY-MM-DD'));
    setAnswers({});
    setSectionIndex(0);
  };

  // With exactly one shift to file, there is nothing to choose — open it.
  useEffect(() => {
    if (!canPickAnyVehicle && myAssignments.length === 1 && !vehicleId) {
      chooseAssignment(myAssignments[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAssignments, canPickAnyVehicle]);

  // For an admin the kind comes from the vehicle list; for a responder it was
  // captured from their assignment, since they never load that list.
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId);
  const effectiveKind = selectedVehicle?.kind ?? vehicleKind;

  // The ER Room uses a different (shorter) template from the ambulances.
  const scope = effectiveKind === 'ER_ROOM' ? 'ER_ROOM' : 'AMBULANCE';

  const {
    data: template,
    isLoading: isTemplateLoading,
    error: templateError,
  } = useQuery({
    queryKey: ['form-active', scope],
    queryFn: () => get('/forms/active', { params: { scope } }),
    // Do not fetch a template until we know which kind of asset it is for.
    enabled: Boolean(vehicleId),
  });

  const sections = template?.sections ?? [];
  const currentSection = sections[sectionIndex];

  // --- Progress --------------------------------------------------------------
  const progress = useMemo(() => {
    if (!template) return { answered: 0, total: 0, percent: 0 };

    const allFields = sections.flatMap((section) => section.fields);
    const answerable = allFields.filter((field) => field.type !== 'SECTION_NOTE');

    const answered = answerable.filter((field) => {
      const value = answers[field.key];
      if (value === undefined || value === null || value === '') return false;

      // A grid counts as answered only when every row has a value — a partly
      // filled matrix is exactly how a shortage slips through unnoticed.
      if (field.type === 'GRID') {
        return (field.config?.rows ?? []).every(
          (row) => value?.[row.key] !== undefined && value?.[row.key] !== null,
        );
      }

      return true;
    }).length;

    return {
      answered,
      total: answerable.length,
      percent: answerable.length === 0 ? 0 : Math.round((answered / answerable.length) * 100),
    };
  }, [template, sections, answers]);

  // --- Saving ----------------------------------------------------------------
  const canSave = Boolean(vehicleId && teamId && shiftDate && template);

  const save = useMutation({
    mutationFn: (status) =>
      post('/submissions', {
        templateId: template.id,
        vehicleId,
        teamId,
        shiftDate,
        secondPersonName: secondPersonName || null,
        answers,
        status,
      }),
  });

  /**
   * Autosave.
   *
   * Debounced by 5 seconds and skipped while a save is already running, so a
   * fast-moving crew does not generate a request per tap. Only ever saves a
   * DRAFT — submitting stays an explicit, deliberate action.
   */
  const autosaveTimer = useRef(null);
  const hasUnsavedChanges = useRef(false);

  useEffect(() => {
    if (!canSave || Object.keys(answers).length === 0) return;

    hasUnsavedChanges.current = true;
    clearTimeout(autosaveTimer.current);

    autosaveTimer.current = setTimeout(() => {
      if (!save.isPending) {
        save.mutate('DRAFT', {
          onSuccess: () => {
            hasUnsavedChanges.current = false;
          },
          // Autosave failures stay silent: a toast every five seconds on a bad
          // connection would be worse than the problem. The explicit Save
          // button reports failures normally.
          onError: () => {},
        });
      }
    }, 5000);

    return () => clearTimeout(autosaveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `save` identity changes each render
  }, [answers, canSave]);

  /** Warns before closing the tab with unsaved answers. */
  useEffect(() => {
    const handler = (event) => {
      if (hasUnsavedChanges.current) {
        event.preventDefault();
        // Browsers ignore custom text now, but returnValue must be set for the
        // native prompt to appear at all.
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const handleSaveDraft = () => {
    save.mutate('DRAFT', {
      onSuccess: () => {
        hasUnsavedChanges.current = false;
        toast.success(t('reports.draftSaved'));
      },
      onError: (error) => toast.error(error.message),
    });
  };

  const handleSubmit = () => {
    setFieldErrors({});

    save.mutate('SUBMITTED', {
      onSuccess: (submission) => {
        hasUnsavedChanges.current = false;
        toast.success(t('reports.submitted'));
        navigate(`/reports/${submission.id}`);
      },
      onError: (error) => {
        // The API returns `details` keyed by field key for missing required
        // answers — map them straight onto the fields and jump to the first.
        if (error.details) {
          setFieldErrors(error.details);

          const firstMissingKey = Object.keys(error.details)[0];
          const targetIndex = sections.findIndex((section) =>
            section.fields.some((field) => field.key === firstMissingKey),
          );

          if (targetIndex >= 0) setSectionIndex(targetIndex);

          toast.error(
            t('reports.requiredRemaining', { count: Object.keys(error.details).length }),
          );
        } else {
          toast.error(error.message);
        }
      },
    });
  };

  // --- Render ----------------------------------------------------------------
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('reports.newReport')} />

      {/* ---------- Which shift? ---------- */}
      {!canPickAnyVehicle && (
        <div className="card mb-5">
          <div className="card-header">
            <h2 className="text-sm font-semibold text-stone-800">{t('nav.assignments')}</h2>
          </div>

          <div className="card-body">
            {myAssignments.length === 0 ? (
              <div className="py-4 text-center">
                <p className="text-sm text-stone-600">
                  You are not rostered on any vehicle at the moment.
                </p>
                <p className="mt-1 text-xs text-stone-400">
                  Your team admin assigns crews to vehicles. Once you are on one, its report
                  appears here.
                </p>
              </div>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {myAssignments.map((assignment) => {
                  const isSelected = vehicleId === assignment.vehicle.id
                    && shiftDate === dayjs(assignment.shiftDate).format('YYYY-MM-DD');

                  return (
                    <li key={assignment.id}>
                      <button
                        type="button"
                        onClick={() => chooseAssignment(assignment)}
                        className={`w-full rounded-lg border p-3 text-start transition-colors ${
                          isSelected
                            ? 'border-brand-600 bg-brand-subtle'
                            : 'border-surface-border bg-white hover:bg-stone-50'
                        }`}
                        aria-pressed={isSelected}
                      >
                        <span className="block font-medium text-stone-900">
                          {assignment.vehicle.code} · {L(assignment.vehicle)}
                        </span>
                        <span className="block text-xs text-stone-500">
                          {dayjs(assignment.shiftDate).format('ddd D MMM YYYY')} · {L(assignment.team)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ---------- Assignment details (free choice, admins only) ---------- */}
      {canPickAnyVehicle && (
      <div className="card mb-5">
        <div className="card-body grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="vehicle" className="label">
              {t('reports.vehicle')} <span className="text-status-critical">*</span>
            </label>
            <select
              id="vehicle"
              className="input"
              value={vehicleId}
              onChange={(event) => {
                setVehicleId(event.target.value);
                setVehicleKind(
                  vehicles.find((vehicle) => vehicle.id === event.target.value)?.kind ?? null,
                );
                // Switching between an ambulance and the ER room changes the
                // template entirely, so previous answers no longer apply.
                setAnswers({});
                setSectionIndex(0);
              }}
            >
              <option value="">—</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.code} · {L(vehicle)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="team" className="label">
              {t('reports.team')} <span className="text-status-critical">*</span>
            </label>
            <select
              id="team"
              className="input"
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
            >
              <option value="">—</option>
              {myTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {L(team)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="shiftDate" className="label">
              {t('reports.shiftDate')} <span className="text-status-critical">*</span>
            </label>
            <input
              id="shiftDate"
              type="date"
              className="input"
              value={shiftDate}
              onChange={(event) => setShiftDate(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor="secondPerson" className="label">
              {t('reports.secondPerson')}
            </label>
            <input
              id="secondPerson"
              className="input"
              value={secondPersonName}
              onChange={(event) => setSecondPersonName(event.target.value)}
            />
          </div>
        </div>
      </div>
      )}

      {/* ---------- The form ---------- */}
      {!vehicleId && (canPickAnyVehicle || myAssignments.length > 0) && (
        <p className="card p-6 text-center text-sm text-stone-500">
          {canPickAnyVehicle
            ? 'Choose a vehicle to load its equipment report.'
            : 'Choose your shift above to load its equipment report.'}
        </p>
      )}

      {vehicleId && isTemplateLoading && <FullPageSpinner />}

      {vehicleId && templateError && (
        <div className="card p-6 text-center text-sm text-status-critical" role="alert">
          {templateError.message}
        </div>
      )}

      {template && currentSection && (
        <>
          {/* Progress bar — always visible, so "how much is left" is never a guess. */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between text-xs text-stone-500">
              <span>{t('reports.completeness', { percent: progress.percent })}</span>
              <span className="tabular-nums">
                {progress.answered} / {progress.total}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-stone-200"
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>

          {/* Section tabs — horizontally scrollable on a phone. */}
          <div className="mb-4 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="flex gap-1.5" role="tablist" aria-label={t('forms.sections')}>
              {sections.map((section, index) => (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={index === sectionIndex}
                  onClick={() => setSectionIndex(index)}
                  className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium ${
                    index === sectionIndex
                      ? 'bg-brand-600 text-pure-white'
                      : 'bg-white text-stone-600 hover:bg-stone-100'
                  }`}
                >
                  {L(section, 'title')}
                </button>
              ))}
            </div>
          </div>

          <div className="card mb-4">
            <div className="card-header">
              <h2 className="text-sm font-semibold text-stone-800">
                {L(currentSection, 'title')}
              </h2>
              <span className="text-xs text-stone-400">
                {sectionIndex + 1} {t('common.of')} {sections.length}
              </span>
            </div>

            <div className="card-body space-y-3">
              {currentSection.fields.map((field) => (
                <FieldRenderer
                  key={field.id}
                  field={field}
                  value={answers[field.key]}
                  error={fieldErrors[field.key]}
                  onChange={(next) =>
                    setAnswers((current) => {
                      // Removing the key entirely (rather than storing
                      // `undefined`) keeps the payload identical to what the
                      // server considers "unanswered".
                      if (next === undefined) {
                        const { [field.key]: _removed, ...rest } = current;
                        return rest;
                      }
                      return { ...current, [field.key]: next };
                    })
                  }
                />
              ))}
            </div>
          </div>

          {/* Section navigation */}
          <div className="mb-4 flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={sectionIndex === 0}
              onClick={() => {
                setSectionIndex((index) => index - 1);
                // Return to the top: staying scrolled halfway down the previous
                // section is disorienting on a phone.
                window.scrollTo({ top: 0 });
              }}
            >
              <ChevronLeft className="h-4 w-4 flip-in-rtl" aria-hidden="true" />
              {t('common.back')}
            </button>

            <button
              type="button"
              className="btn-secondary"
              disabled={sectionIndex === sections.length - 1}
              onClick={() => {
                setSectionIndex((index) => index + 1);
                window.scrollTo({ top: 0 });
              }}
            >
              {t('common.next')}
              <ChevronRight className="h-4 w-4 flip-in-rtl" aria-hidden="true" />
            </button>
          </div>

          {/*
            Sticky action bar: on a 90-question form the submit button would
            otherwise be hundreds of pixels below the fold at all times.
          */}
          <div
            className="sticky bottom-0 -mx-4 flex gap-2 border-t border-surface-border bg-white/95
                       p-3 backdrop-blur sm:mx-0 sm:rounded-card sm:border"
          >
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={handleSaveDraft}
              disabled={!canSave || save.isPending}
            >
              {save.isPending ? <Spinner size="sm" /> : <Save className="h-4 w-4" />}
              {t('reports.saveDraft')}
            </button>

            <button
              type="button"
              className="btn-primary flex-1"
              onClick={handleSubmit}
              disabled={!canSave || save.isPending}
            >
              {progress.percent === 100 ? (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              {t('reports.submitReport')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
