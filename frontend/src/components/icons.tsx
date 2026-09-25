// 18px line icons for the sidebar (stroke = currentColor).
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const PageIcon = {
  overview: () => <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.2" {...P} /><rect x="11" y="2.5" width="6.5" height="4.5" rx="1.2" {...P} /><rect x="2.5" y="11" width="6.5" height="6.5" rx="1.2" {...P} /><rect x="11" y="9" width="6.5" height="8.5" rx="1.2" {...P} /></svg>,
  monitor: () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 11h3.2l2.2-6 3.8 11 2.4-7 1.4 2H18" {...P} /></svg>,
  alerts: () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8a5 5 0 0 1 10 0c0 4.2 1.8 5.6 1.8 5.6H3.2S5 12.2 5 8Z" {...P} /><path d="M8.3 16.5a1.9 1.9 0 0 0 3.4 0" {...P} /></svg>,
  rca: () => <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" {...P} /><path d="m12.6 12.6 4.6 4.6" {...P} /><path d="M6.4 8.5h4.2M8.5 6.4v4.2" {...P} /></svg>,
  models: () => <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1.6" {...P} /><path d="M8 2.5v2.5M12 2.5v2.5M8 15v2.5M12 15v2.5M2.5 8H5M2.5 12H5M15 8h2.5M15 12h2.5" {...P} /><circle cx="10" cy="10" r="1.8" {...P} /></svg>,
  data: () => <svg viewBox="0 0 20 20" aria-hidden="true"><ellipse cx="10" cy="4.8" rx="6" ry="2.3" {...P} /><path d="M4 4.8v10.4c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3V4.8" {...P} /><path d="M4 10c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3" {...P} /></svg>,
};

export const MenuIcon = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14" {...P} /></svg>;
export const CollapseIcon = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2" {...P} /><path d="M7.5 3v14" {...P} />
    <path d={open ? "m13 8-2 2 2 2" : "m11 8 2 2-2 2"} {...P} /></svg>
);

