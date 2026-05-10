'use client';

import { useEffect, useState } from 'react';

import { Spinner } from '@/components/Spinner';

export type DeleteAccountModalStep = 'confirm' | 'reauth';

type DeleteAccountModalProps = {
  open: boolean;
  step: DeleteAccountModalStep;
  busy: boolean;
  error: string | null;
  reauthProviderId: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  onReauthenticateAndRetry: (password: string | null) => void;
};

export function DeleteAccountModal({
  open,
  step,
  busy,
  error,
  reauthProviderId,
  onCancel,
  onConfirm,
  onReauthenticateAndRetry,
}: DeleteAccountModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');

  // Reset both fields whenever the modal is opened or transitions back to confirm.
  useEffect(() => {
    if (!open || step === 'confirm') {
      setConfirmText('');
      setPassword('');
    }
  }, [open, step]);

  if (!open) {
    return null;
  }

  const canConfirm = confirmText.trim() === 'DELETE';
  const isPasswordProvider = reauthProviderId === 'password';
  const canReauth = !isPasswordProvider || password.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
    >
      <div className="surface-card w-full max-w-lg p-6">
        {step === 'confirm' ? (
          <>
            <h2 id="delete-account-title" className="text-2xl font-extrabold text-slate-900">
              Delete your account?
            </h2>
            <p className="mt-3 text-sm text-slate-700">
              This will permanently delete everything we store for you, including:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>All of your ideas, angles, drafts, and adaptations</li>
              <li>All scheduled posts and reminders</li>
              <li>All saved integration connections (LinkedIn, etc.)</li>
              <li>Your company profile</li>
              <li>Your encrypted OAuth tokens</li>
              <li>Your sign-in itself</li>
            </ul>
            <p className="mt-3 text-sm font-semibold text-red-700">This cannot be undone.</p>
            <p className="mt-2 text-xs text-slate-500">
              External services like LinkedIn or X may still hold tokens you previously authorized —
              revoke them separately in those services if needed.
            </p>

            <div className="mt-4">
              <label htmlFor="delete-account-confirm" className="block text-sm font-medium text-slate-700">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm.
              </label>
              <input
                id="delete-account-confirm"
                type="text"
                autoFocus
                autoComplete="off"
                className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                onClick={onCancel}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                onClick={onConfirm}
                disabled={busy || !canConfirm}
              >
                {busy ? <Spinner size="sm" label="Deleting..." /> : 'Delete account'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="delete-account-title" className="text-2xl font-extrabold text-slate-900">
              Confirm it&apos;s really you
            </h2>
            <p className="mt-3 text-sm text-slate-700">
              For your safety, Firebase requires a fresh sign-in before deleting an account.
              Your data has not been deleted yet — re-authenticate below to finish removing your account.
            </p>

            {isPasswordProvider ? (
              <div className="mt-4">
                <label htmlFor="delete-account-password" className="block text-sm font-medium text-slate-700">
                  Re-enter your password
                </label>
                <input
                  id="delete-account-password"
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-700">
                Click <span className="font-semibold">Continue</span> to re-authenticate with{' '}
                <span className="font-semibold">{reauthProviderId ?? 'your provider'}</span> and
                finish deletion.
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                onClick={onCancel}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                onClick={() => onReauthenticateAndRetry(isPasswordProvider ? password : null)}
                disabled={busy || !canReauth}
              >
                {busy ? <Spinner size="sm" label="Finishing..." /> : 'Continue and delete'}
              </button>
            </div>
          </>
        )}

        {error ? (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default DeleteAccountModal;
