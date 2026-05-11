import { createContext } from "react";
import { Notification } from "@/lib/api/backend";

export type NotificationsContextValue = {
  notifications: Notification[];
  isLoading: boolean;
  isConnected: boolean;
  unreadCount: number;
  loadNotifications: () => Promise<void>;
  markAsRead: (id: string) => Promise<boolean>;
  markAllRead: () => Promise<boolean>;
  deleteNotification: (id: string) => Promise<boolean>;
  clearAll: () => Promise<boolean>;
};

export const NotificationsContext = createContext<NotificationsContextValue | null>(null);
