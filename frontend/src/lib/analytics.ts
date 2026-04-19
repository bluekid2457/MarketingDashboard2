type AuthEventName = 'login_attempt' | 'login_success' | 'login_failure';

type AnalyticsPayload = Record<string, string | number | boolean | null | undefined>;

type WindowWithAnalytics = Window & {
  analytics?: {
    track?: (eventName: string, payload?: AnalyticsPayload) => void;
  };
};

export function trackAuthEvent(eventName: AuthEventName, payload?: AnalyticsPayload): void {
  if (typeof window === 'undefined') {
    return;
  }

  const analytics = (window as WindowWithAnalytics).analytics;
  analytics?.track?.(eventName, payload);
}
