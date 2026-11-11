// device.ts
// Coarse client summary for the panel: device class, OS family and browser
// family, parsed from the User-Agent. Only these three labels are stored, never
// the raw User-Agent string.

export interface DeviceInfo {
  device: 'mobile' | 'tablet' | 'desktop' | null;
  os: string | null;
  browser: string | null;
}

export function parseUserAgent(ua: string | null | undefined): DeviceInfo {
  if (!ua) return { device: null, os: null, browser: null };
  const s = ua.slice(0, 400);

  let os = 'Otro';
  if (/CrOS/.test(s)) os = 'Otro';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(s)) os = 'macOS';
  else if (/Linux|X11/.test(s)) os = 'Linux';

  let device: 'mobile' | 'tablet' | 'desktop' = 'desktop';
  if (/iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s))) device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android/.test(s)) device = 'mobile';

  // Order matters: Edge, Samsung and Opera also say "Chrome"; Chrome says "Safari".
  let browser = 'Otro';
  if (/Edg\/|EdgA\/|EdgiOS\/|Edge\//.test(s)) browser = 'Edge';
  else if (/SamsungBrowser\//.test(s)) browser = 'Samsung';
  else if (/OPR\/|Opera|OPiOS\//.test(s)) browser = 'Otro';
  else if (/Firefox\/|FxiOS\//.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = 'Safari';

  return { device, os, browser };
}

const DEVICE_LABEL: Record<string, string> = { mobile: 'Móvil', tablet: 'Tableta', desktop: 'Escritorio' };

// Spanish label for the team-facing alerts (the stored value stays the English key).
export function deviceLabel(device: string | null | undefined): string | null {
  if (!device) return null;
  return Object.prototype.hasOwnProperty.call(DEVICE_LABEL, device) ? DEVICE_LABEL[device] : device;
}

// "Móvil · iOS · Safari" for alerts. A missing or unknown ("Otro") OS or browser is
// left out instead of printing "Otro · Otro".
export function clientSummary(c: { device: string | null; os: string | null; browser: string | null }): string {
  const known = (v: string | null) => (v && v !== 'Otro' ? v : null);
  return [deviceLabel(c.device), known(c.os), known(c.browser)].filter(Boolean).join(' · ');
}

// ISO 3166-1 alpha-2 only ("XX"/"T1" style Cloudflare placeholders are kept
// out of the letters-only check below and stored as null).
export function cleanCountry(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z]{2}$/.test(v) && v.toUpperCase() !== 'XX' ? v.toUpperCase() : null;
}

export function cleanCity(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
  return c || null;
}

// Flag emoji from a two-letter country code (regional indicator symbols).
export function flagEmoji(cc: string | null | undefined): string {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
