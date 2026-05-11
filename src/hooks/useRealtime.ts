import { useContext } from "react";
import { RealtimeContext } from "@/contexts/RealtimeContextValue";

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used within RealtimeProvider");
  }
  return context;
}
