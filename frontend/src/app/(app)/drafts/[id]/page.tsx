import { redirect } from 'next/navigation';

type DraftLegacyPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ angleId?: string }>;
};

export default async function DraftLegacyRedirectPage(props: DraftLegacyPageProps) {
  const { id } = await props.params;
  const query = props.searchParams ? await props.searchParams : undefined;
  const angleId = typeof query?.angleId === 'string' ? query.angleId.trim() : '';

  const nextPath = angleId
    ? `/storyboard/${encodeURIComponent(id)}?angleId=${encodeURIComponent(angleId)}`
    : `/storyboard/${encodeURIComponent(id)}`;

  redirect(nextPath);
}
