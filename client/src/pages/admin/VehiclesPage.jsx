/**
 * =============================================================================
 *  Vehicles — the ambulances and the ER room
 * =============================================================================
 *  Entirely covered by the generic CRUD page: the resource has no behaviour
 *  beyond create / edit / deactivate, so there is nothing to write by hand.
 * =============================================================================
 */

import { useTranslation } from 'react-i18next';
import { useLocalised } from '@/hooks/useLocalised';
import { CrudPage } from '@/components/CrudPage';

export default function VehiclesPage() {
  const { t } = useTranslation();
  const L = useLocalised();

  const KINDS = [
    { value: 'AMBULANCE', label: 'Ambulance' },
    { value: 'ER_ROOM', label: 'ER Room' },
    { value: 'OTHER', label: 'Other' },
  ];

  return (
    <CrudPage
      title={t('nav.vehicles')}
      queryKey="vehicles"
      url="/vehicles"
      permissions={{ read: 'vehicle:read', manage: 'vehicle:manage' }}
      columns={[
        {
          key: 'code',
          header: 'Code',
          primary: true,
          render: (row) => <span className="font-medium tabular-nums">{row.code}</span>,
        },
        { key: 'name', header: t('roles.roleName'), render: (row) => L(row) },
        {
          key: 'kind',
          header: 'Type',
          render: (row) => KINDS.find((kind) => kind.value === row.kind)?.label ?? row.kind,
        },
      ]}
      fields={[
        { name: 'code', label: 'Code', required: true, help: 'For example 470, or ER.' },
        { name: 'nameEn', label: `${t('roles.roleName')} (EN)`, required: true },
        { name: 'nameAr', label: `${t('roles.roleName')} (AR)`, required: true, dir: 'rtl' },
        {
          name: 'kind',
          label: 'Type',
          type: 'select',
          options: KINDS,
          required: true,
          // The ER room gets a different (shorter) report template, so this is
          // not merely a label — it selects which form crews will fill in.
          help: 'The ER room uses its own equipment report form.',
        },
      ]}
    />
  );
}
