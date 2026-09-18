/** Only a confirmed completed task and a finished final reply may start closing. */
export function canCloseCompletedCard(taskStatus: string | undefined, messages: { role: string; status: string }[], sending: boolean) {
  const last = messages.at(-1);
  return taskStatus === "done" && !sending && !messages.some(message => message.status === "pending") && last?.role === "assistant" && last.status === "complete";
}
export function startCardCloseCountdown(onTick: (seconds: number) => void, onClose: () => void) {
  let remaining = 5;
  onTick(remaining);
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining === 0) { clearInterval(timer); onClose(); }
    else onTick(remaining);
  }, 1000);
  return () => clearInterval(timer);
}
