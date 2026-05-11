import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { notificationsApi, Notification } from "@/lib/api/backend";
import { NotificationsContext } from "@/contexts/NotificationsContext";
import { useRealtime } from "@/hooks/useRealtime";
import { WebSocketMessage } from "@/hooks/useWebSocket";
import { toast } from "sonner";

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { isConnected, addMessageHandler } = useRealtime();

  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === 'notification') {
      const newNotification = message.data as Notification;
      setNotifications(prev => [newNotification, ...prev.filter(item => item.id !== newNotification.id)]);
      toast(newNotification.title, {
        description: newNotification.message,
        icon: getNotificationIcon(newNotification.type),
      });
    }
  }, []);

  useEffect(() => {
    return addMessageHandler(handleWebSocketMessage);
  }, [addMessageHandler, handleWebSocketMessage]);

  const loadNotifications = useCallback(async () => {
    setIsLoading(true);
    const result = await notificationsApi.list();
    if (result.success && result.data) {
      setNotifications(result.data);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const markAsRead = useCallback(async (id: string) => {
    const result = await notificationsApi.markAsRead(id);
    if (result.success) {
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, read: true } : n)
      );
    }
    return result.success;
  }, []);

  const markAllRead = useCallback(async () => {
    const result = await notificationsApi.markAllRead();
    if (result.success) {
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      toast.success("已全部标为已读");
    } else {
      toast.error(result.error || "操作失败");
    }
    return result.success;
  }, []);

  const deleteNotification = useCallback(async (id: string) => {
    const result = await notificationsApi.delete(id);
    if (result.success) {
      setNotifications(prev => prev.filter(n => n.id !== id));
      toast.success("通知已删除");
    } else {
      toast.error(result.error || "删除失败");
    }
    return result.success;
  }, []);

  const clearAll = useCallback(async () => {
    const result = await notificationsApi.clear();
    if (result.success) {
      setNotifications([]);
      toast.success("通知已清空");
    } else {
      toast.error(result.error || "清空失败");
    }
    return result.success;
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  const value = useMemo(() => ({
    notifications,
    isLoading,
    isConnected,
    unreadCount,
    loadNotifications,
    markAsRead,
    markAllRead,
    deleteNotification,
    clearAll,
  }), [notifications, isLoading, isConnected, unreadCount, loadNotifications, markAsRead, markAllRead, deleteNotification, clearAll]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

function getNotificationIcon(type: Notification["type"]): string {
  switch (type) {
    case "reminder": return "⏰";
    case "rss": return "📰";
    case "system": return "⚙️";
    case "error": return "❌";
    default: return "🔔";
  }
}
