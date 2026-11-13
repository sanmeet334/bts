import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Tier 1 Google Maps Platform auth & demo-key quota detection before React mounts
(window as any).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  window.dispatchEvent(
    new CustomEvent('gmp-auth-failure', {
      detail: 'Google Maps authentication failed. Verify your Google Maps API key and enabled APIs.',
    })
  );
};

const origError = console.error;
console.error = (...args: unknown[]) => {
  origError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
  if (
    msg.includes('InvalidKeyMapError') ||
    msg.includes('ApiNotActivatedMapError') ||
    msg.includes('RefererNotAllowedMapError') ||
    msg.includes('ApiProjectMapError')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-auth-failure', { detail: msg }));
  }
};

createRoot(document.getElementById('root')!).render(<App />);
