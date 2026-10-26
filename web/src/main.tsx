import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { ConfirmHost } from "./components/confirm";
import { TooltipProvider } from "./components/ui";
import "./index.css";
import { AppShell } from "./layout/AppShell";
import { CollectionPage } from "./pages/CollectionPage";
import { DatabasePage } from "./pages/DatabasePage";
import { ConnectionRedirect, HomePage } from "./pages/HomePage";
import { MigrationsPage } from "./pages/MigrationsPage";
import { SettingsPage } from "./pages/SettingsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/c/:cid", element: <ConnectionRedirect /> },
      { path: "/c/:cid/:db", element: <DatabasePage /> },
      { path: "/c/:cid/:db/:col", element: <CollectionPage /> },
      { path: "/migrations", element: <MigrationsPage /> },
      { path: "/settings", element: <SettingsPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <ConfirmHost />
        <Toaster position="bottom-right" richColors closeButton toastOptions={{ style: { fontSize: 13 } }} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
