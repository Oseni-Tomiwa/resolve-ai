import type { HTMLAttributes } from 'react';

type LogoSize = 'xs' | 'sm' | 'md';

export function ResolveAILogo({ size = 'md', decorative = false, className, ...props }: { size?: LogoSize; decorative?: boolean } & HTMLAttributes<HTMLSpanElement>) {
  return <span className={['resolveai-logo', `resolveai-logo-${size}`, className].filter(Boolean).join(' ')} {...props}>
    <img src="/resolveai-mark.svg" alt={decorative ? '' : 'ResolveAI'} aria-hidden={decorative || undefined} />
  </span>;
}
