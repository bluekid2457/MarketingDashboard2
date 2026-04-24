import { redirect } from 'next/navigation';

export default function DraftsIndexLegacyRedirectPage() {
  redirect('/storyboard');
}
