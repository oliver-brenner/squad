import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { AuthProvider } from "@/lib/auth/auth-context";
import { AuthGuard } from "@/lib/auth/auth-guard";
import { PowerSyncProvider } from "@/lib/db/provider";
import { AppLayout } from "@/routes/app-layout";
import { Landing } from "@/routes/landing";
import { AuthCallback } from "@/routes/auth-callback";
import { Dashboard } from "@/routes/dashboard/dashboard";
import { Settings } from "@/routes/settings/settings";
import { FieldsEditor } from "@/routes/settings/fields-editor";
import { Exercises } from "@/routes/exercises/exercises";
import { ExerciseDetail } from "@/routes/exercises/exercise-detail";
import { Log } from "@/routes/log/log";
import { NewSession } from "@/routes/log/new-session";
import { EditSession } from "@/routes/log/edit-session";
import { WorkoutEditorRoute } from "@/routes/log/workout-editor";

const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/auth/callback", element: <AuthCallback /> },
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
          { path: "/dashboard", element: <Dashboard /> },
          { path: "/exercises", element: <Exercises /> },
          { path: "/exercises/:id", element: <ExerciseDetail /> },
          { path: "/log", element: <Log /> },
          { path: "/log/new", element: <NewSession /> },
          { path: "/log/:id", element: <WorkoutEditorRoute /> },
          { path: "/log/:id/edit", element: <EditSession /> },
          { path: "/settings", element: <Settings /> },
          { path: "/settings/fields", element: <FieldsEditor /> },
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
