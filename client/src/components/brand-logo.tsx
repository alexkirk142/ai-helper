interface BrandLogoIconProps {
  className?: string;
  size?: number;
}

export function BrandLogoIcon({ className, size = 32 }: BrandLogoIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="nexus-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
      </defs>
      {/* Back bubble */}
      <rect x="2" y="4" width="19" height="13" rx="4" fill="url(#nexus-grad)" opacity="0.25" />
      {/* Mid bubble */}
      <rect x="5" y="2" width="19" height="13" rx="4" fill="url(#nexus-grad)" opacity="0.5" />
      {/* Front bubble */}
      <rect x="4" y="8" width="22" height="15" rx="4" fill="url(#nexus-grad)" />
      {/* Three dots */}
      <circle cx="11" cy="15.5" r="1.5" fill="white" />
      <circle cx="15.5" cy="15.5" r="1.5" fill="white" />
      <circle cx="20" cy="15.5" r="1.5" fill="white" />
      {/* Tail */}
      <path d="M10 23 L7 28 L15 25.5 Z" fill="url(#nexus-grad)" />
    </svg>
  );
}

export const BRAND_NAME = "NexusChat";
export const BRAND_TAGLINE = "Умная автоматизация";
