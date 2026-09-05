export type RallyIconKind = "back" | "undo" | "redo" | "close" | "pause" | "play";

interface RallyIconProps {
  kind: RallyIconKind;
  className?: string;
}

export function RallyIcon({ kind, className }: RallyIconProps) {
  const iconClass = className ? `rally-icon ${className}` : "rally-icon";
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={iconClass}
      data-ui-icon={kind}
    >
      {kind === "back" ? (
        <path d="M15.5 5.25 8.75 12l6.75 6.75M9.5 12h10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : kind === "undo" ? (
        <>
          <path d="M9 7.25H5.25V3.5" fill="none" stroke="currentColor" strokeWidth="2.35" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.75 7.35c2.05-2.35 5.62-3.05 8.43-1.58 3.12 1.63 4.34 5.47 2.73 8.58-1.24 2.38-3.92 3.76-6.57 3.33" fill="none" stroke="currentColor" strokeWidth="2.35" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : kind === "redo" ? (
        <>
          <path d="M15 7.25h3.75V3.5" fill="none" stroke="currentColor" strokeWidth="2.35" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M18.25 7.35c-2.05-2.35-5.62-3.05-8.43-1.58-3.12 1.63-4.34 5.47-2.73 8.58 1.24 2.38 3.92 3.76 6.57 3.33" fill="none" stroke="currentColor" strokeWidth="2.35" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : kind === "close" ? (
        <path d="m6.5 6.5 11 11m0-11-11 11" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" />
      ) : kind === "pause" ? (
        <>
          <rect x="6.25" y="4.5" width="3.9" height="15" rx="1.15" fill="currentColor" />
          <rect x="13.85" y="4.5" width="3.9" height="15" rx="1.15" fill="currentColor" />
        </>
      ) : (
        <path d="M8.25 5.2v13.6L18.4 12Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      )}
    </svg>
  );
}
