import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthProvider";
import ProtectedRoute from "./components/ProtectedRoute";
import { AdminLayout } from "./components/layout/AdminLayout";
import Dashboard from "./pages/Dashboard";
import AIChatPage from "./pages/AIChatPage";
import RSSPage from "./pages/RSSPage";
import TrendingPage from "./pages/TrendingPage";
import PriceMonitorPage from "./pages/PriceMonitorPage";
import GitHubMonitorPage from "./pages/GitHubMonitorPage";
import ToolsPage from "./pages/ToolsPage";
import RemindersPage from "./pages/RemindersPage";
import LogsPage from "./pages/LogsPage";
import QuickSendPage from "./pages/QuickSendPage";
import NotificationsPage from "./pages/NotificationsPage";
import SettingsPage from "./pages/SettingsPage";
import StickersPage from "./pages/StickersPage";
import ScheduledTasksPage from "./pages/ScheduledTasksPage";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <ProtectedRoute>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/ai-chat" element={<AIChatPage />} />
              <Route path="/rss" element={<RSSPage />} />
              <Route path="/trending" element={<TrendingPage />} />
              <Route path="/price-monitor" element={<PriceMonitorPage />} />
              <Route path="/github-monitor" element={<GitHubMonitorPage />} />
              <Route path="/tools" element={<ToolsPage />} />
              <Route path="/reminders" element={<RemindersPage />} />
              <Route path="/stickers" element={<StickersPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/quick-send" element={<QuickSendPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/scheduled-tasks" element={<ScheduledTasksPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;