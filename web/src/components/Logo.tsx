export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <rect width="64" height="64" rx="14" className="fill-ink" />
      <path d="M18 44V20h6v18.5h14V44H18z" className="fill-bg" />
      <rect x="40" y="20" width="6" height="12" rx="1.5" fill="#6B8AF0" />
    </svg>
  );
}
