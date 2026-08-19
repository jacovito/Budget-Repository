"use client";
import { useEffect, useState } from "react";
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
export default function PwaClient() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const initialStatus = window.setTimeout(() => { setOnline(navigator.onLine); setDismissed(sessionStorage.getItem("paycheck-install-dismissed") === "true"); }, 0);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const on = () => setOnline(true), off = () => setOnline(false), clear = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", capture); window.addEventListener("appinstalled", clear); window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { clearTimeout(initialStatus); window.removeEventListener("beforeinstallprompt", capture); window.removeEventListener("appinstalled", clear); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  async function install() { if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); }
  function dismiss() { sessionStorage.setItem("paycheck-install-dismissed", "true"); setDismissed(true); }
  return <>{!online && <div className="offline-badge" role="status">Offline · local data is still available</div>}{installPrompt && !dismissed && <div className="install-banner"><span>P</span><div><strong>Install Paycheck</strong><small>Open it like an app and keep the shell available offline.</small></div><div><button onClick={() => void install()}>Install</button><button onClick={dismiss}>Not now</button></div></div>}</>;
}
