import { createContext } from "react";
import { WebSocketMessage } from "@/hooks/useWebSocket";

export type RealtimeContextValue = {
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
  addMessageHandler: (handler: (message: WebSocketMessage) => void) => () => void;
};

export const RealtimeContext = createContext<RealtimeContextValue | null>(null);
