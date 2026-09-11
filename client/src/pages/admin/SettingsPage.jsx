/**
 * =============================================================================
 *  Station settings
 * =============================================================================
 *  The server owns the list of valid settings and each one's shape. This page
 *  renders whatever it is given and posts the value back, so adding a setting
 *  is a one-line change on the server with no frontend work at all.
 * =============================================================================
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';

import { get, put } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { FullPageSpinner } from '@/components/Spinner';
import { useToast } from '@/components/Toast';

export default function SettingsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  /** Local edits, keyed by setting key, applied on save. */
  const [drafts, setDrafts] = useState({});

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => get('/settings'),
  });

  useEffect(() => {
    if (settings.length === 0) return;
    setDrafts(Object.fromEntries(settings.map((setting) => [setting.key, setting.value])));
  }, [settings]);

  const save = useMutation({
    mutationFn: ({ key, value }) => put(`/settings/${key}`, { value }),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (isLoading) return <FullPageSpinner />;

  /** Updates one property inside a setting's object value. */
  const patchDraft = (key, property, value) =>
    setDrafts((current) => ({ ...current, [key]: { ...current[key], [property]: value } }));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('settings.title')} />

      <div className="space-y-4">
        {settings.map((setting) => (
          <section key={setting.key} className="card">
            <div className="card-header">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-stone-800">{setting.key}</h2>
                <p className="text-xs text-stone-500">{setting.description}</p>
              </div>

              <button
                type="button"
                className="btn-primary btn-sm shrink-0"
                onClick={() => save.mutate({ key: setting.key, value: drafts[setting.key] })}
                disabled={save.isPending}
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {t('common.save')}
              </button>
            </div>

            <div className="card-body grid gap-3 sm:grid-cols-2">
              {/*
                Rendered generically from the value's own shape: a boolean gets
                a checkbox, a number an input, a string a text field. That is
                what lets the server add a setting without touching this file.
              */}
              {Object.entries(drafts[setting.key] ?? {}).map(([property, value]) => (
                <div key={property}>
                  <label htmlFor={`${setting.key}-${property}`} className="label">
                    {property}
                  </label>

                  {typeof value === 'boolean' ? (
                    <input
                      id={`${setting.key}-${property}`}
                      type="checkbox"
                      className="h-5 w-5 rounded border-surface-border text-brand-600"
                      checked={value}
                      onChange={(event) =>
                        patchDraft(setting.key, property, event.target.checked)
                      }
                    />
                  ) : typeof value === 'number' ? (
                    <input
                      id={`${setting.key}-${property}`}
                      type="number"
                      inputMode="numeric"
                      className="input"
                      value={value}
                      onChange={(event) =>
                        patchDraft(setting.key, property, Number(event.target.value))
                      }
                    />
                  ) : (
                    <input
                      id={`${setting.key}-${property}`}
                      className="input"
                      // Arabic values need RTL entry to be typed comfortably.
                      dir={property === 'ar' ? 'rtl' : undefined}
                      value={value ?? ''}
                      onChange={(event) => patchDraft(setting.key, property, event.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
