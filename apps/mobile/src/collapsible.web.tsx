import React, { useEffect, useState } from "react";

export function Collapsible({ open, animate = true, children }: React.PropsWithChildren<{ open: boolean; animate?: boolean }>) {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  if (!animate) return <>{children}</>;
  return <div
    inert={!open}
    aria-hidden={!open}
    style={{
      display: "grid", minWidth: 0,
      gridTemplateRows: open ? "1fr" : "0fr",
      opacity: open ? 1 : 0,
      transition: reduceMotion ? "none" : "grid-template-rows 240ms cubic-bezier(0.2, 0, 0, 1), opacity 180ms ease",
    }}
  >
    <div style={{ minHeight: 0, overflow: "hidden" }}>{children}</div>
  </div>;
}
