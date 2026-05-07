import { redirect } from 'next/navigation';

/**
 * Root route — redirects to the static HTML landing page.
 * The landing page lives at frontend/public/landingPages/index.html
 * and is also caught by the next.config.js redirect for /
 */
export default function Home() {
  redirect('/landingPages/index.html');
}
