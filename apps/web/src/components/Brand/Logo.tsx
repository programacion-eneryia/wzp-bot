/** Isotipo Eneryeter: "E" de tres trazos con un punto de conversación. */
export default function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--accent)" />
      <path
        d="M10 9.5h12M10 16h8M10 22.5h12"
        stroke="#0b0b0d"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="22.5" cy="16" r="2" fill="#0b0b0d" />
    </svg>
  );
}
