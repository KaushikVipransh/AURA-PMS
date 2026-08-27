/**
 * The application shell (W6-01 … W6-05).
 *
 * Four providers, in an order that matters: the query client needs the toaster
 * mounted to report errors, and the auth provider needs the query client
 * nowhere at all — it uses the API client directly, so a session check cannot
 * be delayed behind a cache that has not warmed.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

import { RequireAuth } from './components/RequireAuth.js';
import { useAuth } from './lib/auth-context.js';
import { AuthProvider } from './lib/auth.js';
import { createQueryClient } from './lib/query.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
import { AppraisalPage } from './pages/AppraisalPage.js';
import { CalibrationPage } from './pages/CalibrationPage.js';
import { CheckInPage } from './pages/CheckInPage.js';
import { CompliancePage } from './pages/CompliancePage.js';
import { CycleSetupPage } from './pages/CycleSetupPage.js';
import { GoalsPage } from './pages/GoalsPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { QueuePage } from './pages/QueuePage.js';
import { RatingPage } from './pages/RatingPage.js';
import { ReviewPage } from './pages/ReviewPage.js';
import { UsersPage } from './pages/UsersPage.js';

/** Where a signed-in user lands, decided by what they are. */
function Home() {
  const { user } = useAuth();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">AuraPMS</h1>
      <p className="mt-2 text-sm text-slate-600">
        Signed in as {user?.name} ({user?.roles.join(', ')}).
      </p>
    </main>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <Home />
          </RequireAuth>
        }
      />

      <Route
        path="/goals"
        element={
          <RequireAuth>
            <GoalsPage />
          </RequireAuth>
        }
      />

      <Route
        path="/check-in"
        element={
          <RequireAuth>
            <CheckInPage />
          </RequireAuth>
        }
      />

      <Route
        path="/appraisal"
        element={
          <RequireAuth>
            <AppraisalPage />
          </RequireAuth>
        }
      />

      <Route
        path="/queue"
        element={
          <RequireAuth roles={['MANAGER', 'HR_ADMIN', 'ORG_ADMIN']}>
            <QueuePage />
          </RequireAuth>
        }
      />

      <Route
        path="/queue/:sheetId"
        element={
          <RequireAuth roles={['MANAGER', 'HR_ADMIN', 'ORG_ADMIN']}>
            <ReviewPage />
          </RequireAuth>
        }
      />

      <Route
        path="/queue/:sheetId/rating"
        element={
          <RequireAuth roles={['MANAGER', 'HR_ADMIN', 'ORG_ADMIN']}>
            <RatingPage />
          </RequireAuth>
        }
      />

      <Route
        path="/admin"
        element={
          <RequireAuth roles={['HR_ADMIN', 'ORG_ADMIN']}>
            <UsersPage />
          </RequireAuth>
        }
      />

      <Route
        path="/admin/cycles"
        element={
          <RequireAuth roles={['HR_ADMIN', 'ORG_ADMIN']}>
            <CycleSetupPage />
          </RequireAuth>
        }
      />

      <Route
        path="/admin/calibration"
        element={
          <RequireAuth roles={['HR_ADMIN', 'ORG_ADMIN']}>
            <CalibrationPage />
          </RequireAuth>
        }
      />

      <Route
        path="/admin/analytics"
        element={
          <RequireAuth roles={['HR_ADMIN', 'ORG_ADMIN']}>
            <AnalyticsPage />
          </RequireAuth>
        }
      />

      <Route
        path="/admin/compliance"
        element={
          <RequireAuth roles={['HR_ADMIN', 'ORG_ADMIN']}>
            <CompliancePage />
          </RequireAuth>
        }
      />

      {/* An unknown path is not an error worth a page of its own yet. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  // Built once per mount rather than at module scope, so a test can render two
  // independent apps without them sharing a cache.
  const queryClient = useMemo(() => createQueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
        {/* Replaces 23 `alert()` calls, which blocked the main thread and
            could not be styled, stacked, or read by a screen reader. */}
        <Toaster richColors closeButton position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
