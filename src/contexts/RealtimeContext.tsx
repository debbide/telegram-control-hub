import { ReactNode, useCallback, useMemo, useRef } from "react";
import { RealtimeContext } from "@/contexts/RealtimeContextValue";
import { useWebSocket, WebSocketMessage } from "@/hooks/useWebSocket";

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const handlersRef = useRef(new Set<(message: WebSocketMessage) => void>());

  const handleMessage = useCallback((message: WebSocketMessage) => {
    handlersRef.current.forEach(handler => handler(message));
  }, []);

  const { isConnected, lastMessage } = useWebSocket({
    onMessage: handleMessage,
    autoReconnect: true,
  });

  const addMessageHandler = useCallback((handler: (message: WebSocketMessage) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const value = useMemo(() => ({
    isConnected,
    lastMessage,
    addMessageHandler,
  }), [isConnected, lastMessage, addMessageHandler]);

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}
