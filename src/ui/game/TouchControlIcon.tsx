export type TouchControlIconKind =
  | "lane-left"
  | "lane-right"
  | "pitch-up"
  | "pitch-down"
  | "ride"
  | "turbo";

interface TouchControlIconProps {
  kind: TouchControlIconKind;
  label?: string;
}

function BikeFrame() {
  return (
    <>
      <circle cx="17" cy="41" r="8" />
      <circle cx="47" cy="41" r="8" />
      <path d="m17 41 11-15 9 15H17l8-12h13l9 12-4-18h7" />
      <path d="M24 23h10" />
    </>
  );
}

function Rider() {
  return (
    <>
      <circle cx="37" cy="13" r="4.2" fill="currentColor" stroke="none" />
      <path d="m35 19-7 8 9 5 7-10" />
      <path d="m29 27-7 12M37 32l8 7" />
    </>
  );
}

function DirectionChevron({ direction }: { direction: "left" | "right" }) {
  const transform = direction === "left" ? undefined : "translate(64 0) scale(-1 1)";
  return (
    <path
      d="M43 8 17 32l26 24 7-8-17-16 17-16Z"
      fill="currentColor"
      stroke="none"
      transform={transform}
    />
  );
}

function PitchArrow({ direction }: { direction: "up" | "down" }) {
  return direction === "up" ? (
    <path d="m32 3-10 11h6v8h8v-8h6Z" fill="currentColor" stroke="none" />
  ) : (
    <path d="m32 61 10-11h-6v-8h-8v8h-6Z" fill="currentColor" stroke="none" />
  );
}

function IconArtwork({ kind }: { kind: TouchControlIconKind }) {
  switch (kind) {
    case "lane-left":
      return <DirectionChevron direction="left" />;
    case "lane-right":
      return <DirectionChevron direction="right" />;
    case "pitch-up":
      return (
        <>
          <PitchArrow direction="up" />
          <g transform="translate(0 8)"><BikeFrame /></g>
        </>
      );
    case "pitch-down":
      return (
        <>
          <g transform="translate(0 -8)"><BikeFrame /></g>
          <PitchArrow direction="down" />
        </>
      );
    case "ride":
      return (
        <>
          <BikeFrame />
          <Rider />
        </>
      );
    case "turbo":
      return (
        <>
          <path d="M4 22h13M2 32h13M6 42h12" />
          <circle cx="39" cy="32" r="19" />
          <circle cx="39" cy="32" r="4.5" fill="currentColor" stroke="none" />
          <path d="M39 15c6 0 11 3 14 8l-12 5Z" fill="currentColor" stroke="none" />
          <path d="M56 32c0 6-3 11-8 14l-5-12Z" fill="currentColor" stroke="none" />
          <path d="M39 49c-6 0-11-3-14-8l12-5Z" fill="currentColor" stroke="none" />
          <path d="M22 32c0-6 3-11 8-14l5 12Z" fill="currentColor" stroke="none" />
        </>
      );
  }
}

export function TouchControlIcon({ kind, label }: TouchControlIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`touch-control-visual touch-control-visual-${kind}`}
      data-touch-icon={kind}
    >
      <svg
        aria-hidden="true"
        className="touch-control-icon"
        fill="none"
        focusable="false"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.8"
        viewBox="0 0 64 64"
      >
        <IconArtwork kind={kind} />
      </svg>
      {label ? <span className="touch-control-label">{label}</span> : null}
    </span>
  );
}
