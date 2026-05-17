import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AuthProvider } from "@/lib/auth/auth-context";
import { AuthGuard } from "@/lib/auth/auth-guard";
import { PowerSyncProvider } from "@/lib/db/provider";
import { AppLayout } from "@/routes/app-layout";
import { Landing } from "@/routes/landing";

// Each authenticated route is loaded on demand via React Router's `lazy`
// option. This keeps the initial JS bundle small — the user only downloads
// the code for the page they're actually on. Landing stays inline because
// unauthenticated visits to "/" should paint instantly. AuthCallback also
// stays lazy since users only hit it during the OAuth bounce.
const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  {
    path: "/auth/callback",
    lazy: async () => {
      const { AuthCallback } = await import("@/routes/auth-callback");
      return { Component: AuthCallback };
    },
  },
  {
    element: <AuthGuard />,
    children: [
      {
        element: (
          <PowerSyncProvider>
            <AppLayout />
          </PowerSyncProvider>
        ),
        children: [
          {
            path: "/dashboard",
            lazy: async () => {
              const { Dashboard } = await import("@/routes/dashboard/dashboard");
              return { Component: Dashboard };
            },
          },
          {
            path: "/exercises",
            lazy: async () => {
              const { Exercises } = await import("@/routes/exercises/exercises");
              return { Component: Exercises };
            },
          },
          {
            path: "/exercises/:id",
            lazy: async () => {
              const { ExerciseDetail } = await import("@/routes/exercises/exercise-detail");
              return { Component: ExerciseDetail };
            },
          },
          {
            path: "/log",
            lazy: async () => {
              const { Log } = await import("@/routes/log/log");
              return { Component: Log };
            },
          },
          {
            path: "/log/new",
            lazy: async () => {
              const { NewSession } = await import("@/routes/log/new-session");
              return { Component: NewSession };
            },
          },
          {
            path: "/log/:id",
            lazy: async () => {
              const { WorkoutEditorRoute } = await import("@/routes/log/workout-editor");
              return { Component: WorkoutEditorRoute };
            },
          },
          {
            path: "/log/:id/edit",
            lazy: async () => {
              const { EditSession } = await import("@/routes/log/edit-session");
              return { Component: EditSession };
            },
          },
          {
            path: "/settings",
            lazy: async () => {
              const { Settings } = await import("@/routes/settings/settings");
              return { Component: Settings };
            },
          },
          {
            path: "/settings/fields",
            lazy: async () => {
              const { FieldsEditor } = await import("@/routes/settings/fields-editor");
              return { Component: FieldsEditor };
            },
          },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
