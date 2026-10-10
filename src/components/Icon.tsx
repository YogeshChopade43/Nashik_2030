const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35',
  layers: 'M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 18l10 5 10-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  locate: 'M10 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0M5.5 12a6.5 6.5 0 1 0 13 0 6.5 6.5 0 1 0-13 0M12 2v3M12 19v3M2 12h3M19 12h3',
  home: 'M3 11 12 3l9 8M5 9.5V21h5v-6h4v6h5V9.5',
  close: 'M6 6l12 12M18 6 6 18',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-5M12 8h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  pin: 'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  filter: 'M4 5.5h16l-6.2 7.3V18l-3.6 1.8v-7z',
  legend: 'M4.5 6.5h2M4.5 12h2M4.5 17.5h2M9.5 6.5h10M9.5 12h10M9.5 17.5h10',
  share: 'M4 12.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6.5M12 3.5v12M7.5 8 12 3.5 16.5 8',
  nearby: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5z',
  eyeOff: 'M3 3l18 18M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.9 3.6M6.5 7.2C3.9 8.9 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1M9.9 10a2.75 2.75 0 0 0 4 3.9',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'size-4' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Category marker for the UI: same glyph + colour as the map's atlas markers. */
export function Mark({ glyph, color, className = 'size-7' }: { glyph?: string; color: string; className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-[#fffdf8] ${className}`} style={{ boxShadow: `inset 0 0 0 1.5px ${color}, 0 1px 2px rgb(60 40 20 / 0.18)` }}>
      {glyph ? (
        <svg viewBox="0 0 24 24" className="size-[62%]" fill="none" stroke={color} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={glyph} /></svg>
      ) : (
        <span className="size-[38%] rounded-full" style={{ background: color }} />
      )}
    </span>
  );
}
