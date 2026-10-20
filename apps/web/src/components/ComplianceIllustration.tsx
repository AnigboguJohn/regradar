/**
 * Original outline-style illustration of the five pillars of compliance
 * (rules, law, ethics, regulations, standards). Pure inline SVG: no image
 * files, crisp at any size, and free of third-party licensing.
 */
import type { ReactNode } from "react";

const INK = "#1e293b";
const S = { stroke: INK, strokeWidth: 2.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Tile({ x, y, label, children }: { x: number; y: number; label: string; children: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx="70" cy="68" r="62" fill="#eef2f6" />
      {/* sparkles */}
      <path d="M112 14 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="none" {...S} strokeWidth={1.6} />
      <path d="M128 34 l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2z" fill="none" {...S} strokeWidth={1.4} />
      <line x1="10" y1="130" x2="130" y2="130" {...S} strokeWidth={1.6} />
      <g>{children}</g>
      <text x="70" y="160" textAnchor="middle" fontSize="15" fontWeight="700" letterSpacing="1.5" fill={INK}
        fontFamily="Georgia, 'Times New Roman', serif">{label}</text>
    </g>
  );
}

const Check = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <path d={`M${x} ${y} l${6 * s} ${6 * s} l${12 * s} ${-13 * s}`} fill="none" stroke="#65a30d" strokeWidth={4 * Math.max(s, 0.8)} strokeLinecap="round" strokeLinejoin="round" />
);

export function ComplianceIllustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 520 390" className={className} role="img" aria-labelledby="ci-title">
      <title id="ci-title">Compliance: rules, law, ethics, regulations and standards</title>

      {/* RULES: clipboard checklist */}
      <Tile x={10} y={0} label="RULES">
        <rect x="38" y="30" width="64" height="88" rx="6" fill="#fff" {...S} />
        <rect x="56" y="24" width="28" height="12" rx="3" fill="#cbd5e1" {...S} />
        {[52, 74, 96].map((cy) => (
          <g key={cy}>
            <Check x={46} y={cy} s={0.75} />
            <line x1="68" y1={cy + 1} x2="92" y2={cy + 1} stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
          </g>
        ))}
      </Tile>

      {/* LAW: scales of justice + gavel */}
      <Tile x={190} y={0} label="LAW">
        <line x1="70" y1="30" x2="70" y2="112" {...S} />
        <rect x="50" y="112" width="40" height="8" rx="2" fill="#cbd5e1" {...S} />
        <line x1="36" y1="42" x2="104" y2="42" {...S} />
        <circle cx="70" cy="30" r="4" fill="#fbbf24" {...S} />
        <path d="M36 42 l-12 30 h24z M104 42 l-12 30 h24z" fill="none" {...S} strokeWidth={1.8} />
        <path d="M22 72 a14 8 0 0 0 28 0z" fill="#fecaca" {...S} />
        <path d="M90 72 a14 8 0 0 0 28 0z" fill="#fecaca" {...S} />
        <g transform="rotate(-35 104 104)">
          <rect x="90" y="96" width="30" height="14" rx="3" fill="#94a3b8" {...S} />
          <line x1="105" y1="110" x2="105" y2="128" {...S} strokeWidth={4} />
        </g>
      </Tile>

      {/* ETHICS: compass */}
      <Tile x={370} y={0} label="ETHICS">
        <circle cx="70" cy="72" r="38" fill="#fff" {...S} />
        <circle cx="70" cy="72" r="30" fill="none" stroke="#cbd5e1" strokeWidth="2" />
        <path d="M70 44 l9 28 -9 28 -9 -28z" fill="#fff" {...S} strokeWidth={2} />
        <path d="M70 44 l9 28 h-18z" fill="#f87171" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        <circle cx="70" cy="72" r="3.5" fill={INK} />
        <text x="70" y="40" textAnchor="middle" fontSize="9" fontWeight="700" fill={INK}>N</text>
        <path d="M112 112 c-6 -14 4 -24 10 -26 c2 10 -2 20 -10 26z" fill="#bbf7d0" {...S} strokeWidth={1.8} />
      </Tile>

      {/* REGULATIONS: document + milestone flags */}
      <Tile x={100} y={200} label="REGULATIONS">
        <path d="M30 28 h40 l12 12 v76 h-52z" fill="#fff" {...S} />
        <path d="M70 28 v12 h12" fill="none" {...S} />
        {[52, 64, 76, 88, 100].map((y, i) => (
          <line key={y} x1="38" y1={y} x2={i % 2 ? 66 : 74} y2={y} stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
        ))}
        <line x1="98" y1="30" x2="98" y2="116" {...S} strokeWidth={2} />
        {[
          { y: 30, c: "#86efac" },
          { y: 60, c: "#fde047" },
          { y: 90, c: "#fca5a5" },
        ].map((f) => (
          <g key={f.y}>
            <circle cx="98" cy={f.y + 14} r="3.5" fill="#fff" {...S} strokeWidth={1.8} />
            <path d={`M98 ${f.y} h20 l-5 6 5 6 h-20z`} fill={f.c} {...S} strokeWidth={1.8} />
          </g>
        ))}
      </Tile>

      {/* STANDARDS: interlocking gears + check */}
      <Tile x={280} y={200} label="STANDARDS">
        <Gear cx={52} cy={84} r={22} teeth={8} fill="#fda4af" />
        <Gear cx={90} cy={50} r={17} teeth={7} fill="#bbf7d0" />
        <Check x={28} y={34} s={1.2} />
        <rect x="88" y="98" width="26" height="8" rx="3" fill="#a5b4fc" {...S} strokeWidth={1.8} />
        <rect x="88" y="108" width="26" height="8" rx="3" fill="#a5b4fc" {...S} strokeWidth={1.8} />
      </Tile>
    </svg>
  );
}

function Gear({ cx, cy, r, teeth, fill }: { cx: number; cy: number; r: number; teeth: number; fill: string }) {
  const pts: string[] = [];
  const outer = r + 6;
  for (let i = 0; i < teeth * 2; i++) {
    const a1 = (Math.PI * i) / teeth;
    const a2 = (Math.PI * (i + 1)) / teeth;
    const rad = i % 2 === 0 ? outer : r;
    pts.push(`${cx + rad * Math.cos(a1)},${cy + rad * Math.sin(a1)}`, `${cx + rad * Math.cos(a2)},${cy + rad * Math.sin(a2)}`);
  }
  return (
    <g>
      <polygon points={pts.join(" ")} fill={fill} {...S} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={r * 0.4} fill="#fff" {...S} strokeWidth={2} />
    </g>
  );
}
