"use client";

import { useEffect, useRef, useId, type ReactNode } from "react";

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    activity: <><path d="M4 6h16M4 12h10M4 18h13" /><circle cx="19" cy="17" r="3" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 10h18m-14 5 3 3 6-6" /></>,
    budget: <><path d="M8 4h8m-8 0H5v17h14V4h-3M8 2v4h8V2zM8 11h8m-8 5h5" /></>,
    goals: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
    debt: <><path d="m4 6 6 6 4-4 6 10m-6 0h6v-6" /></>,
    investing: <><path d="m3 17 7-7 4 4 7-9m-7 0h7v7" /></>,
    worth: <><rect x="3" y="6" width="18" height="15" rx="3" /><path d="M3 9V5a2 2 0 0 1 2-2h13m-2 10h5v5h-5a2.5 2.5 0 0 1 0-5z" /></>,
    learn: <><circle cx="12" cy="12" r="9" /><path d="M10 9a2 2 0 1 1 3 2c-1 .5-1 1-1 2m0 3h.01" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2" /></>,
    income: <><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
    review: <><path d="m12 3 10 18H2L12 3zm0 6v5m0 3h.01" /></>,
    groceries: <><path d="M3 3h2l3 13h11l2-9H6M9 21h.01M18 21h.01" /></>,
    gas: <><path d="M4 21V4h10v17M2 21h14M7 7h4v5H7zm7 1 4 4v6a2 2 0 0 0 4 0v-7l-3-4" /></>,
    "fast-food": <><path d="M4 9a8 6 0 0 1 16 0H4zm-1 4h18M4 17h16v4H4z" /></>,
    restaurants: <><path d="M5 3v6a3 3 0 0 0 6 0V3M8 3v18m11-18v18m0-18c-5 3-5 9 0 9" /></>,
    bills: <><path d="M5 3h14v19l-3-2-4 2-4-2-3 2V3zm4 5h6m-6 5h6" /></>,
    subscriptions: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3V9z" /></>,
    "car-transportation": <><path d="m5 7 2-4h10l2 4 2 4v8H3v-8l2-4zm0 0h14M3 13h18M6 16h.01M18 16h.01M6 19v2m12-2v2" /></>,
    personal: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    shopping: <><path d="M4 7h16l1 14H3L4 7zm4 0V5a4 4 0 0 1 8 0v2" /></>,
    giving: <path d="M12 21 3 12a5.5 5.5 0 0 1 9-6 5.5 5.5 0 0 1 9 6l-9 9z" />,
    tax: <><path d="m3 8 9-5 9 5H3zm2 3v7m7-7v7m7-7v7M3 21h18" /></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] || <><rect x="4" y="4" width="16" height="16" rx="5" /><path d="M8 12h8" /></>}</svg>;
}

export function ActionDialog({ open, onClose, title, subtitle, children, wide = false, notice }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode; wide?: boolean; notice?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prior; };
  }, [open]);
  return <dialog ref={ref} className={wide ? "action-dialog wide" : "action-dialog"} aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <header className="dialog-heading"><div><h2 id={id}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><Icon name="close" /></button></header>
    <div className="dialog-content">{children}{open && notice && <p className="dialog-notice" role="status">{notice}</p>}</div>
  </dialog>;
}

export function PaidCheckbox({ name, paid, onChange, disabled = false }: { name: string; paid: boolean; onChange: () => void; disabled?: boolean }) {
  return <label className={paid ? "paid-checkbox checked" : "paid-checkbox"} title={disabled ? "Matched to a transaction. Edit the transaction to change this payment." : `Mark ${name} ${paid ? "unpaid" : "paid"}`}>
    <input type="checkbox" checked={paid} disabled={disabled} onChange={onChange} aria-label={`Mark ${name} ${paid ? "unpaid" : "paid"}`} />
    <span><Icon name="check" size={16} /></span>
  </label>;
}

export function SpendingRing({ categories, total, money, onSelect }: { categories: { id: string; name: string; color: string; spent: number }[]; total: number; money: (amount: number) => string; onSelect: (id: string) => void }) {
  const visibleCategories = categories.filter((category) => category.spent > 0 && total > 0);
  return <div className="spending-ring"><svg viewBox="0 0 240 240" aria-label="Actual spending by category" role="group">
    <circle cx="120" cy="120" r="94" fill="none" stroke="#edf0f7" strokeWidth="24" />
    {visibleCategories.map((category, index) => {
      const share = category.spent / total * 100;
      const start = visibleCategories.slice(0, index).reduce((sum, item) => sum + item.spent / total * 100, 0);
      return <circle key={category.id} cx="120" cy="120" r="94" pathLength="100" fill="none" stroke={category.color} strokeWidth="24" strokeDasharray={`${Math.max(.05, share - .8)} ${100 - Math.max(.05, share - .8)}`} strokeDashoffset={-start} transform="rotate(-90 120 120)" role="button" tabIndex={0} aria-label={`${category.name}: ${money(category.spent)}`} onClick={() => onSelect(category.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(category.id); } }}><title>{category.name} · {money(category.spent)}</title></circle>;
    })}
  </svg><div className="ring-center"><span>Actual spending</span><strong>{money(total)}</strong><small>{total ? "Tap a category" : "Your spending starts here"}</small></div></div>;
}
