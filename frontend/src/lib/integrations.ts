export type IntegrationConnection = {
  provider: string;
  label: string;
  authTypes: string[];
  supportsDirectPublish: boolean;
  supportsScheduledPublish: boolean;
  oauthStrategy?: string | null;
  supportedContentTypes: string[];
  status: string;
  authType?: string | null;
  accountId?: string | null;
  accountUrn?: string | null;
  displayName?: string | null;
  email?: string | null;
  pictureUrl?: string | null;
  scopes?: string[];
  connectedAtMs?: number | null;
  updatedAtMs?: number | null;
  tokenExpiresAtMs?: number | null;
  hasRefreshToken?: boolean;
  metadata?: Record<string, unknown>;
};

type IntegrationStatusResponse = {
  connections: IntegrationConnection[];
};

type LinkedInStartResponse = {
  provider: 'linkedin';
  authorizeUrl: string;
  scopes: string[];
};

type DisconnectResponse = {
  connection: IntegrationConnection;
};

function getErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const detail = 'detail' in payload ? payload.detail : undefined;
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }

  const message = 'message' in payload ? payload.message : undefined;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  return fallback;
}

export function getBackendApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  return 'http://localhost:8000';
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getBackendApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Request failed with status ${response.status}.`));
  }

  return payload as T;
}

export async function listIntegrationConnections(userId: string): Promise<IntegrationConnection[]> {
  const params = new URLSearchParams({ userId });
  const payload = await requestJson<IntegrationStatusResponse>(`/api/v1/integrations/status?${params.toString()}`);
  return payload.connections;
}

export async function startLinkedInConnection(userId: string, redirectAfter = '/settings'): Promise<LinkedInStartResponse> {
  return requestJson<LinkedInStartResponse>('/api/v1/auth/linkedin/start', {
    method: 'POST',
    body: JSON.stringify({ userId, redirectAfter }),
  });
}

export async function disconnectIntegration(provider: string, userId: string): Promise<IntegrationConnection> {
  const payload = await requestJson<DisconnectResponse>(`/api/v1/integrations/${provider}/disconnect`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
  return payload.connection;
}