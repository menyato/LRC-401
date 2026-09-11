/**
 * =============================================================================
 *  Application shell
 * =============================================================================
 *  Header, navigation and the page outlet.
 *
 *  NAVIGATION IS BUILT FROM PERMISSIONS. Each entry declares what it needs, and
 *  entries the user cannot use are not rendered. An empty group disappears
 *  entirely, so an EMT sees a short, clear menu rather than a long one full of
 *  links that would only produce errors.
 *
 *  (As always: this is presentation. The server enforces the same permissions.)
 *
 *  RESPONSIVE: a fixed sidebar on desktop; on mobile a slide-over drawer, since
 *  a permanent sidebar would eat half a phone screen.
 * =============================================================================
 */

import { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PackageSearch,
  LayoutDashboard,
  ClipboardList,
  CalendarDays,
  Boxes,
  Shirt,
  Stethoscope,
  ArrowLeftRight,
  CalendarClock,
  Users,
  ShieldCheck,
  UsersRound,
  Truck,
  FileCog,
  BarChart3,
  ScrollText,
  Settings,
  Menu,
  X,
  LogOut,
  UserCircle,
} from 'lucide-react';

import { useAuth } from '@/features/auth/AuthProvider';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LrcLogo } from '@/components/LrcLogo';

export default function AppLayout() {
  const { t } = useTranslation();
  const { user, logout, can, canAny } = useAuth();
  const location = useLocation();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Close the drawer on navigation — otherwise tapping a link on a phone leaves
  // the menu covering the page you just opened.
  useEffect(() => {
    setIsDrawerOpen(false);
  }, [location.pathname]);

  /**
   * The navigation tree.
   *
   * `permission` / `anyOf` decide visibility. Declaring it here (rather than
   * with `{can(...) && <NavLink/>}` scattered through the JSX) means the whole
   * menu can be read and audited in one place.
   */
  const groups = [
    {
      items: [
        { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard, end: true },
      ],
    },
    {
      label: t('nav.reports'),
      items: [
        {
          to: '/reports/new',
          label: t('nav.fillReport'),
          icon: ClipboardList,
          permission: 'submission:create',
        },
        {
          to: '/reports/board',
          label: t('nav.board'),
          icon: CalendarDays,
          anyOf: ['submission:read.team', 'submission:read.all'],
        },
        {
          to: '/reports/restock',
          label: t('restock.title'),
          icon: PackageSearch,
          permission: 'restock:read',
        },
        {
          to: '/reports',
          label: t('nav.reports'),
          icon: ScrollText,
          anyOf: ['submission:read.own', 'submission:read.team', 'submission:read.all'],
        },
      ],
    },
    {
      label: t('nav.inventory'),
      items: [
        {
          to: '/inventory/medical_equipment',
          label: t('nav.equipment'),
          icon: Stethoscope,
          permission: 'inventory.item:read',
        },
        {
          to: '/inventory/clothing',
          label: t('nav.clothing'),
          icon: Shirt,
          permission: 'inventory.item:read',
        },
        {
          to: '/inventory/medical_equipment/movements',
          label: t('nav.movements'),
          icon: ArrowLeftRight,
          permission: 'inventory.movement:read',
        },
        {
          to: '/expiring',
          label: t('nav.expiring'),
          icon: CalendarClock,
          permission: 'inventory.item:read',
        },
      ],
    },
    {
      label: t('nav.people'),
      items: [
        { to: '/admin/users', label: t('nav.users'), icon: Users, permission: 'user:read' },
        { to: '/admin/roles', label: t('nav.roles'), icon: ShieldCheck, permission: 'role:read' },
        { to: '/admin/teams', label: t('nav.teams'), icon: UsersRound, permission: 'team:read' },
        { to: '/admin/vehicles', label: t('nav.vehicles'), icon: Truck, permission: 'vehicle:read' },
        {
          to: '/admin/assignments',
          label: t('nav.assignments'),
          icon: CalendarDays,
          anyOf: ['assignment:read.team', 'assignment:read.all'],
        },
      ],
    },
    {
      label: t('nav.settings'),
      items: [
        {
          to: '/forms',
          label: t('nav.formBuilder'),
          icon: FileCog,
          permission: 'form.template:read',
        },
        {
          to: '/statistics',
          label: t('nav.statistics'),
          icon: BarChart3,
          permission: 'stats:view',
        },
        {
          to: '/admin/activity',
          label: t('nav.activity'),
          icon: ScrollText,
          permission: 'audit:read',
        },
        {
          to: '/admin/settings',
          label: t('nav.settings'),
          icon: Settings,
          permission: 'settings:manage',
        },
      ],
    },
  ];

  /** Drops items the user cannot use, then drops groups left with nothing. */
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.permission) return can(item.permission);
        if (item.anyOf) return canAny(item.anyOf);
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-surface-muted">
      {/* ==================== HEADER ==================== */}
      <header className="sticky top-0 z-30 border-b border-brand-700 bg-brand-600 text-pure-white no-print">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          {/* Drawer toggle — mobile only. */}
          <button
            type="button"
            className="rounded-lg p-2 hover:bg-brand-700 lg:hidden"
            onClick={() => setIsDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={isDrawerOpen}
          >
            <Menu className="h-5 w-5" />
          </button>

          <Link to="/" className="flex items-center gap-2.5 min-w-0">
            <LrcLogo className="h-9 w-9 shrink-0 drop-shadow-sm" />
            <span className="truncate text-sm font-semibold sm:text-base">
              {t('common.appName')}
            </span>
          </Link>

          <div className="ms-auto flex items-center gap-2">
            <ThemeToggle />

            <div className="hidden sm:block">
              <LanguageToggle />
            </div>

            <Link
              to="/account"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-brand-700"
              title={user?.fullName}
            >
              <UserCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="hidden max-w-[10rem] truncate text-sm md:inline">
                {user?.fullName}
              </span>
            </Link>

            <button
              type="button"
              onClick={logout}
              className="rounded-lg p-2 hover:bg-brand-700"
              aria-label={t('auth.signOut')}
              title={t('auth.signOut')}
            >
              <LogOut className="h-5 w-5 flip-in-rtl" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* ==================== SIDEBAR (desktop) ==================== */}
        <aside
          className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto
                     border-e border-surface-border bg-white lg:block no-print"
        >
          <NavigationTree groups={visibleGroups} />
        </aside>

        {/* ==================== DRAWER (mobile) ==================== */}
        {isDrawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            {/*
              The backdrop is a button so it can be closed by keyboard as well
              as by tapping — a plain div with onClick is unreachable without a
              pointer.
            */}
            <button
              type="button"
              className="absolute inset-0 bg-black/40 animate-fade-in"
              onClick={() => setIsDrawerOpen(false)}
              aria-label="Close navigation"
            />

            <nav
              className="absolute inset-y-0 start-0 w-72 max-w-[85vw] overflow-y-auto bg-white 
                         shadow-popover animate-slide-up"
            >
              <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
                <span className="text-sm font-semibold text-stone-900">{t('common.appName')}</span>
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen(false)}
                  className="rounded p-1.5 text-stone-400 hover:bg-stone-100"
                  aria-label={t('common.close')}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <NavigationTree groups={visibleGroups} />

              <div className="border-t border-surface-border p-4 sm:hidden">
                <LanguageToggle compact />
              </div>
            </nav>
          </div>
        )}

        {/* ==================== PAGE ==================== */}
        {/*
          `min-w-0` is essential: without it a wide table inside a flex child
          refuses to shrink and pushes the whole page sideways.
        */}
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Decides which single nav entry is highlighted: the one whose path is the
 * LONGEST match for the current URL.
 *
 * React Router's own `isActive` marks a link active whenever the URL merely
 * starts with its path, so several entries lit up at once — opening
 * `/reports/new` highlighted both"Fill a report" AND"Equipment reports"
 * (`/reports`), and the stock movements page highlighted its parent store too.
 *
 * Sprinkling `end` on the parents would fix those two cases and silently break
 * again the next time a nested route is added — and it would leave detail pages
 * such as `/reports/<id>` with nothing highlighted at all. Choosing the longest
 * match handles every case, including ones not written yet: a detail page falls
 * back to its section, and a more specific entry always beats a more general
 * one.
 *
 * @param {Array<{to: string}>} items  Every nav entry, across all groups.
 * @param {string} pathname
 * @returns {string|null} The `to` of the entry to highlight.
 */
function resolveActivePath(items, pathname) {
  let best = null;

  for (const item of items) {
    const isExact = pathname === item.to;
    // The trailing slash matters: without it"/reports" would match
    //"/reportsomething".
    const isDescendant = item.to !== '/' && pathname.startsWith(`${item.to}/`);

    if (!isExact && !isDescendant) continue;

    if (best === null || item.to.length > best.length) best = item.to;
  }

  return best;
}

/** The link list. Shared by the desktop sidebar and the mobile drawer. */
function NavigationTree({ groups }) {
  const location = useLocation();

  // Flattened once so the longest-match search sees entries from every group —
  //"/reports" and"/reports/new" live in the same group today, but nothing
  // guarantees that stays true.
  const allItems = groups.flatMap((group) => group.items);
  const activePath = resolveActivePath(allItems, location.pathname);

  return (
    <nav className="p-3">
      {groups.map((group, index) => (
        <div key={group.label ?? index} className={index > 0 ? 'mt-5' : ''}>
          {group.label && (
            <h2 className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-stone-400">
              {group.label}
            </h2>
          )}

          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const isActive = item.to === activePath;

              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    // Active state is computed above, not by React Router, so
                    // exactly one entry is ever highlighted.
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-brand-subtle font-medium text-brand-strong'
                        : 'text-stone-700 hover:bg-stone-100 '
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
