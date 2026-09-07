// Hand-drawn glyphs. Slightly soft, slightly heavy — faceplate silkscreen, not
// a modern icon set. Everything inherits currentColor.

interface P {
  size?: number;
  className?: string;
}

const svg = (size: number, className: string | undefined, children: React.ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const Play = ({ size = 24, className }: P) =>
  svg(size, className, <path d="M8.5 5.6 18 12l-9.5 6.4z" fill="currentColor" stroke="none" />);

export const Pause = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <rect x="8" y="5.6" width="2.9" height="12.8" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.1" y="5.6" width="2.9" height="12.8" rx="1" fill="currentColor" stroke="none" />
    </>,
  );

export const Prev = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <path d="M17.5 6.4 9.5 12l8 5.6z" fill="currentColor" stroke="none" />
      <rect x="6" y="6.2" width="2" height="11.6" rx="1" fill="currentColor" stroke="none" />
    </>,
  );

export const Next = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <path d="M6.5 6.4 14.5 12l-8 5.6z" fill="currentColor" stroke="none" />
      <rect x="16" y="6.2" width="2" height="11.6" rx="1" fill="currentColor" stroke="none" />
    </>,
  );

export const Shuffle = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <path d="M3 7h3.4c1.3 0 2 .7 2.8 1.9l4 6.2c.8 1.2 1.5 1.9 2.8 1.9H20" />
      <path d="M3 17h3.4c1.3 0 2-.7 2.8-1.9l4-6.2C14 7.7 14.7 7 16 7H20" />
      <path d="m17.6 4.6 2.6 2.4-2.6 2.4" />
      <path d="m17.6 14.6 2.6 2.4-2.6 2.4" />
    </>,
  );

export const Repeat = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <path d="M6.5 8.5h9.2A3.3 3.3 0 0 1 19 11.8v.4" />
      <path d="M17.5 15.5H8.3A3.3 3.3 0 0 1 5 12.2v-.4" />
      <path d="m8.6 6.1-2.4 2.4 2.4 2.4" />
      <path d="m15.4 17.9 2.4-2.4-2.4-2.4" />
    </>,
  );

export const RepeatOne = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <path d="M6.5 8.5h9.2A3.3 3.3 0 0 1 19 11.8v.4" />
      <path d="M17.5 15.5H8.3A3.3 3.3 0 0 1 5 12.2v-.4" />
      <path d="m8.6 6.1-2.4 2.4 2.4 2.4" />
      <path d="m15.4 17.9 2.4-2.4-2.4-2.4" />
      <path d="M11.4 10.6 12.6 10v4" strokeWidth={1.5} />
    </>,
  );

export const Crossfade = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <path d="M3 17.5c5 0 6-11 12-11" />
      <path d="M21 17.5c-5 0-6-11-12-11" />
    </>,
  );

export const Search = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <circle cx="10.7" cy="10.7" r="5.7" />
      <path d="m15 15 4.4 4.4" />
    </>,
  );

export const Close = ({ size = 24, className }: P) =>
  svg(size, className, <path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4" />);

export const Plus = ({ size = 24, className }: P) =>
  svg(size, className, <path d="M12 6v12M6 12h12" />);

export const QueueNext = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <path d="M4 7h10M4 12h10M4 17h6" />
      <path d="m16 12 5 3.2-5 3.2z" fill="currentColor" stroke="none" />
    </>,
  );

export const Speaker = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <rect x="6.5" y="3.5" width="11" height="17" rx="2.2" />
      <circle cx="12" cy="14.5" r="3" />
      <circle cx="12" cy="7.6" r="1.1" />
    </>,
  );

export const Muted = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <path d="M5 9.5h3l4-3.2v11.4l-4-3.2H5z" />
      <path d="m16 9.8 4 4.4M20 9.8l-4 4.4" />
    </>,
  );

export const Sound = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <path d="M5 9.5h3l4-3.2v11.4l-4-3.2H5z" />
      <path d="M15.6 9.4a3.7 3.7 0 0 1 0 5.2" />
      <path d="M18 7.2a7 7 0 0 1 0 9.6" />
    </>,
  );

export const Back = ({ size = 24, className }: P) =>
  svg(size, className, <path d="M14.5 5.5 8 12l6.5 6.5" />);

export const Radar = ({ size = 24, className }: P) =>
  svg(
    size,
    className,
    <>
      <path d="M12 12 5.6 5.6" />
      <path d="M8.2 15.8a5.4 5.4 0 0 1 7.6-7.6" opacity="0.55" />
      <path d="M5.4 18.6a9.3 9.3 0 0 1 13.2-13.2" opacity="0.3" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>,
  );
