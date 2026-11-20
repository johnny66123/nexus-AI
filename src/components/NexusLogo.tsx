interface NexusLogoProps {
  compact?: boolean;
}

export function NexusLogo({ compact = false }: NexusLogoProps) {
  return (
    <div className="flex items-center gap-3 select-none">
      <svg
        width="30"
        height="30"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="nexusLogoGrad" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <rect
          x="2"
          y="2"
          width="28"
          height="28"
          rx="7"
          fill="#0B1120"
          stroke="url(#nexusLogoGrad)"
          strokeWidth="1.5"
        />
        <path
          d="M10 21.5V10.5L22 21.5V10.5"
          stroke="url(#nexusLogoGrad)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="10.5" r="1.5" fill="#60A5FA" />
        <circle cx="22" cy="21.5" r="1.5" fill="#A78BFA" />
      </svg>
      {!compact && (
        <span className="font-display text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
          NEXUS AI
        </span>
      )}
    </div>
  );
}
