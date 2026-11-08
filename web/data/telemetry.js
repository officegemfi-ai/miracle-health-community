// Analytics and error tracking: optional, and never given health content.
import { loadScript } from './scripts.js';

export function track(event, props) {
  try { window.posthog?.capture?.(event, props || {}); } catch (_) { /* optional */ }
}

export async function startTelemetry(C) {
  if (C.posthogKey) {
    try {
      await loadScript(`${C.posthogAssets || 'https://us-assets.i.posthog.com'}/static/array.js`);
      window.posthog?.init(C.posthogKey, {
        api_host: C.posthogHost || 'https://us.i.posthog.com',
        autocapture: false,            // would capture post titles
        capture_pageview: false,       // we send screen names only
        disable_session_recording: true,
        person_profiles: 'identified_only',
      });
    } catch (_) { /* analytics is optional */ }
  }
  if (C.sentryDsn && C.sentryBundle) {
    try {
      await loadScript(C.sentryBundle);
      window.Sentry?.init({
        dsn: C.sentryDsn, environment: C.environment || 'live', sendDefaultPii: false,
        beforeBreadcrumb: (b) => (b.category === 'ui.input' || b.category === 'fetch' ? null : b),
        beforeSend: (event) => { if (event.request) delete event.request.data; return event; },
      });
    } catch (_) { /* error tracking is optional */ }
  }
}
