import Nav from '@/components/Nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Nav />
      <main className="flex-1 ml-64 p-8">{children}</main>
    </div>
  );
}
