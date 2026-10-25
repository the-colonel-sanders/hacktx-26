/** Belugo's mark: a source with two wavefronts reaching out from it. */
export default function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="logoMark">
      <circle cx="6" cy="12" r="3" fill="currentColor" />
      <path d="M11 6.5a8 8 0 0 1 0 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M15.5 3a12.5 12.5 0 0 1 0 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}
