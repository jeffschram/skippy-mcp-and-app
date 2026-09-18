"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type Harness = "claude" | "codex";
const MindChatContext = createContext<{
  cardActive: boolean; setCardActive: (value: boolean) => void;
  harness: Harness; setHarness: (value: Harness) => void;
}>({ cardActive: false, setCardActive: () => {}, harness: "claude", setHarness: () => {} });
export function MindChatProvider({ children }: { children: ReactNode }) {
  const [cardActive, setCardActive] = useState(false);
  const [harness, setHarness] = useState<Harness>("claude");
  const value = useMemo(() => ({ cardActive, setCardActive, harness, setHarness }), [cardActive, harness]);
  return <MindChatContext.Provider value={value}>{children}</MindChatContext.Provider>;
}
export const useMindChat = () => useContext(MindChatContext);
