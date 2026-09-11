/**
 * =============================================================================
 *  Routes
 * =============================================================================
 *  The whole navigable surface of the app, in one file.
 *
 *  Two guards do the work:
 *    <PublicOnly>  — login and invitation pages; redirects away if signed in
 *    <Protected>   — everything else; redirects to /login if not, and can
 *                    additionally require a permission
 *
 *  `Protected` checking a permission is a CONVENIENCE, not security. It saves a
 *  user from opening a page that would only show errors. The server enforces
 *  the same permission on every endpoint the page calls.
 * =============================================================================
 */

import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '@/features/auth/AuthProvider';
import AppLayout from '@/layouts/AppLayout';
import AuthLayout from '@/layouts/AuthLayout';
import { FullPageSpinner } from '@/components/Spinner';

// --- Auth pages: eager, because one of them is the first thing most visitors
//     see and a lazy chunk would add a spinner before the login form.
import LoginPage from '@/pages/auth/LoginPage';
import AcceptInvitationPage from '@/pages/auth/AcceptInvitationPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage';
import ChangePasswordPage from '@/pages/auth/ChangePasswordPage';

// --- Everything else: lazily loaded.
//     A volunteer who only fills in reports never downloads the form builder or
//     the role editor. On a mobile connection that is a real saving.
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const DayBoardPage = lazy(() => import('@/pages/reports/DayBoardPage'));
const RestockBoardPage = lazy(() => import('@/pages/reports/RestockBoardPage'));
const ReportListPage = lazy(() => import('@/pages/reports/ReportListPage'));
const ReportFillPage = lazy(() => import('@/pages/reports/ReportFillPage'));
const ReportViewPage = lazy(() => import('@/pages/reports/ReportViewPage'));
const InventoryPage = lazy(() => import('@/pages/inventory/InventoryPage'));
const MovementsPage = lazy(() => import('@/pages/inventory/MovementsPage'));
const ExpiringPage = lazy(() => import('@/pages/inventory/ExpiringPage'));
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'));
const RolesPage = lazy(() => import('@/pages/admin/RolesPage'));
const TeamsPage = lazy(() => import('@/pages/admin/TeamsPage'));
const VehiclesPage = lazy(() => import('@/pages/admin/VehiclesPage'));
const AssignmentsPage = lazy(() => import('@/pages/admin/AssignmentsPage'));
const FormBuilderListPage = lazy(() => import('@/pages/forms/FormBuilderListPage'));
const FormBuilderPage = lazy(() => import('@/pages/forms/FormBuilderPage'));
const StatisticsPage = lazy(() => import('@/pages/StatisticsPage'));
const ActivityPage = lazy(() => import('@/pages/admin/ActivityPage'));
const SettingsPage = lazy(() => import('@/pages/admin/SettingsPage'));
const AccountPage = lazy(() => import('@/pages/AccountPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

/**
 * Requires a signed-in user, and optionally a permission.
 *
 * @param {string} [permission]  Permission key required to view the page.
 * @param {string[]} [anyOf]     Or: any one of these.
 */
function Protected({ children, permission, anyOf }) {
  const { isAuthenticated, isInitialising, user, can, canAny } = useAuth();
  const location = useLocation();

  // Wait for the silent refresh on startup. Rendering the redirect first would
  // bounce an already-signed-in user to /login on every page reload.
  if (isInitialising) return <FullPageSpinner />;

  if (!isAuthenticated) {
    // `state.from` lets the login page send them back where they were going —
    // important for the emailed links that deep-link into a report.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // An admin-reset password must be changed before anything else. The server
  // enforces this too (middleware/auth.js); this only avoids showing pages that
  // would fail.
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  const allowed = permission ? can(permission) : anyOf ? canAny(anyOf) : true;

  // Send them somewhere useful rather than to a dead end.
  if (!allowed) return <Navigate to="/" replace />;

  return children;
}

/** Login and invitation pages — pointless once signed in. */
function PublicOnly({ children }) {
  const { isAuthenticated, isInitialising } = useAuth();

  if (isInitialising) return <FullPageSpinner />;
  if (isAuthenticated) return <Navigate to="/" replace />;

  return children;
}

export default function App() {
  return (
    <Routes>
      {/* ================= PUBLIC ================= */}
      <Route element={<AuthLayout />}>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <LoginPage />
            </PublicOnly>
          }
        />
        <Route
          path="/accept-invitation"
          element={
            <PublicOnly>
              <AcceptInvitationPage />
            </PublicOnly>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicOnly>
              <ForgotPasswordPage />
            </PublicOnly>
          }
        />
        <Route
          path="/reset-password"
          element={
            <PublicOnly>
              <ResetPasswordPage />
            </PublicOnly>
          }
        />
      </Route>

      {/*
        Forced password change: authenticated, but OUTSIDE the main layout so
        the navigation is not offered to someone who cannot use it yet.
      */}
      <Route element={<AuthLayout />}>
        <Route
          path="/change-password"
          element={
            <Protected>
              <ChangePasswordPage />
            </Protected>
          }
        />
      </Route>

      {/* ================= AUTHENTICATED ================= */}
      <Route
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        {/* Suspense catches the lazy chunks while they download. */}
        <Route
          index
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <DashboardPage />
            </Suspense>
          }
        />

        {/* --- Equipment reports --- */}
        <Route
          path="reports"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected anyOf={['submission:read.own', 'submission:read.team', 'submission:read.all']}>
                <ReportListPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="reports/board"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected anyOf={['submission:read.team', 'submission:read.all']}>
                <DayBoardPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="reports/restock"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="restock:read">
                <RestockBoardPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="reports/new"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="submission:create">
                <ReportFillPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="reports/:id"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <ReportViewPage />
            </Suspense>
          }
        />

        {/* --- Inventory (one engine, two stores, chosen by :category) --- */}
        <Route
          path="inventory/:category"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="inventory.item:read">
                <InventoryPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="inventory/:category/movements"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="inventory.movement:read">
                <MovementsPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="expiring"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="inventory.item:read">
                <ExpiringPage />
              </Protected>
            </Suspense>
          }
        />

        {/* --- Administration --- */}
        <Route
          path="admin/users"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="user:read">
                <UsersPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="admin/roles"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="role:read">
                <RolesPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="admin/teams"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="team:read">
                <TeamsPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="admin/vehicles"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="vehicle:read">
                <VehiclesPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="admin/assignments"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected anyOf={['assignment:read.team', 'assignment:read.all']}>
                <AssignmentsPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="admin/activity"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="audit:read">
                <ActivityPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="admin/settings"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="settings:manage">
                <SettingsPage />
              </Protected>
            </Suspense>
          }
        />

        {/* --- Form builder --- */}
        <Route
          path="forms"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="form.template:read">
                <FormBuilderListPage />
              </Protected>
            </Suspense>
          }
        />
        <Route
          path="forms/:id"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="form.template:manage">
                <FormBuilderPage />
              </Protected>
            </Suspense>
          }
        />

        <Route
          path="statistics"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <Protected permission="stats:view">
                <StatisticsPage />
              </Protected>
            </Suspense>
          }
        />

        <Route
          path="account"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <AccountPage />
            </Suspense>
          }
        />

        <Route
          path="*"
          element={
            <Suspense fallback={<FullPageSpinner />}>
              <NotFoundPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
