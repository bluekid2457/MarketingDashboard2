import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Flowrite',
  description: 'AI-powered marketing content management dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className="text-slate-800"
        style={{ fontFamily: '"Manrope", "Segoe UI", "Helvetica Neue", Arial, sans-serif' }}
      >
        {children}
      </body>
    </html>
  );
}
