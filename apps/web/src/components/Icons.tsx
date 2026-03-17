import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="m9 18 6-6-6-6" /></BaseIcon>;
}

export function ChevronDownIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="m6 9 6 6 6-6" /></BaseIcon>;
}

export function FolderIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="M3 7.5h6l2 2H21v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" /></BaseIcon>;
}

export function ArrowUpRightIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="M7 17 17 7" /><path d="M9 7h8v8" /></BaseIcon>;
}

export function MessageSquareIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 4.25c4.56 0 8.25 2.93 8.25 6.54 0 3.62-3.69 6.55-8.25 6.55-.84 0-1.66-.1-2.43-.3L5.5 19l1.35-3.13c-1.92-1.2-3.1-3.08-3.1-5.08 0-3.61 3.69-6.54 8.25-6.54Z" />
    </BaseIcon>
  );
}

export function ShareIcon(props: IconProps) {
  return <BaseIcon {...props}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.8 6.8-3.6" /><path d="m8.6 13.2 6.8 3.6" /></BaseIcon>;
}

export function MoreHorizontalIcon(props: IconProps) {
  return <BaseIcon {...props}><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></BaseIcon>;
}

export function SunIcon(props: IconProps) {
  return <BaseIcon {...props}><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5" /><path d="M12 19.5V22" /><path d="m4.93 4.93 1.77 1.77" /><path d="m17.3 17.3 1.77 1.77" /><path d="M2 12h2.5" /><path d="M19.5 12H22" /><path d="m4.93 19.07 1.77-1.77" /><path d="m17.3 6.7 1.77-1.77" /></BaseIcon>;
}

export function MoonIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="M21 12.79A9 9 0 1 1 11.21 3c0 .16-.01.32-.01.49A7.5 7.5 0 0 0 18.5 11c.88 0 1.73-.15 2.5-.42" /></BaseIcon>;
}

export function MonitorIcon(props: IconProps) {
  return <BaseIcon {...props}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" /></BaseIcon>;
}

export function ArrowLeftIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></BaseIcon>;
}

export function MinusIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="M5 12h14" /></BaseIcon>;
}

export function PlusIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="M12 5v14" /><path d="M5 12h14" /></BaseIcon>;
}

export function PencilIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="m3 21 3.75-.75L18 9l-3-3L3.75 17.25z" /><path d="m14.5 6.5 3 3" /></BaseIcon>;
}

export function CopyIcon(props: IconProps) {
  return <BaseIcon {...props}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></BaseIcon>;
}

export function SettingsIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="M12 3v2.5" /><path d="M12 18.5V21" /><path d="m4.93 4.93 1.77 1.77" /><path d="m17.3 17.3 1.77 1.77" /><path d="M3 12h2.5" /><path d="M18.5 12H21" /><path d="m4.93 19.07 1.77-1.77" /><path d="m17.3 6.7 1.77-1.77" /><circle cx="12" cy="12" r="3.5" /></BaseIcon>;
}

export function XIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="m6 6 12 12" /><path d="M18 6 6 18" /></BaseIcon>;
}

export function MailIcon(props: IconProps) {
  return <BaseIcon {...props}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></BaseIcon>;
}

export function LockIcon(props: IconProps) {
  return <BaseIcon {...props}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 1 1 8 0v3" /></BaseIcon>;
}

export function GithubIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="M9 19c-4.5 1.4-4.5-2.5-6-3m12 6v-3.5a3.1 3.1 0 0 0-.9-2.4c3-.3 6.1-1.5 6.1-6.7A5.2 5.2 0 0 0 18.8 5.8 4.8 4.8 0 0 0 18.7 2S17.5 1.7 15 3.4a13.3 13.3 0 0 0-6 0C6.5 1.7 5.3 2 5.3 2a4.8 4.8 0 0 0-.1 3.8A5.2 5.2 0 0 0 3.8 9.4c0 5.2 3.1 6.4 6.1 6.7A3.1 3.1 0 0 0 9 18.5V22" /></BaseIcon>;
}

export function GlobeIcon(props: IconProps) {
  return <BaseIcon {...props}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /></BaseIcon>;
}

export function CheckIcon(props: IconProps) {
  return <BaseIcon {...props}><path d="m5 12 4 4L19 6" /></BaseIcon>;
}
