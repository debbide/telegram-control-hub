import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { RealtimeProvider } from "@/contexts/RealtimeContext";
import { NotificationsProvider } from "@/contexts/NotificationsProvider";

export function AdminLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <RealtimeProvider>
      <NotificationsProvider>
        <div className="min-h-screen bg-background flex w-full">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <Header onMenuClick={() => setSidebarCollapsed(!sidebarCollapsed)} />
          <main className="flex-1 p-6 overflow-auto">
            <Outlet />
          </main>
        </div>
        </div>
      </NotificationsProvider>
    </RealtimeProvider>
  );
}
