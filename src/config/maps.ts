const PLACEHOLDER_KEYS = new Set([
  '',
  'YOUR_API_KEY',
  'MY_GOOGLE_MAPS_API_KEY',
  'REPLACE_WITH_GOOGLE_MAPS_API_KEY',
]);

export function getGoogleMapsApiKey(): string {
  const raw = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
  if (!raw || PLACEHOLDER_KEYS.has(raw)) {
    return '';
  }
  return raw;
}

export function dispatchGmpQuotaExceeded(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
}

export function dispatchGmpAuthFailure(reason?: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gmp-auth-failure', { detail: reason }));
  }
}

export function isQuotaError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as Record<string, any>;
  const status = anyErr?.status ?? anyErr?.code ?? anyErr?.response?.status;
  if (status === 429 || status === 'RESOURCE_EXHAUSTED' || status === 'OVER_QUERY_LIMIT') {
    return true;
  }
  const msg = String(anyErr?.message || anyErr?.error?.status || anyErr || '');
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('OVER_QUERY_LIMIT') ||
    msg.includes('OverQuotaMapError') ||
    msg.includes('QuotaExceededError') ||
    msg.includes('429')
  );
}
