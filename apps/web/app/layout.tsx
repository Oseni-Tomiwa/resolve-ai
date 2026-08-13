import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { AuthProvider } from './auth-provider';
import './globals.css';
export const metadata: Metadata = { title: 'ResolveAI', description: 'AI that resolves.', icons: { icon: '/resolveai-mark.svg', apple: '/resolveai-mark.svg' } };
export default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body><AuthProvider>{children}</AuthProvider></body></html>; }
