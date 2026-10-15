import { hostLocale, tOptional } from "./i18n";
import { sncfBadge } from "./sncf";

/** Escapes text inserted in HTML. */
export function esc(value: string | number | null | undefined): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** `HH:mm` of an ISO date, in the time zone of the place when known. */
export function time(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return "--:--";
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  try {
    return new Date(iso).toLocaleTimeString(hostLocale(), tz ? { ...options, timeZone: tz } : options);
  } catch {
    return new Date(iso).toLocaleTimeString(hostLocale(), options);
  }
}

/** Day of an ISO date, e.g. "Fri 9 Oct". */
export function day(iso: string | null | undefined, tz?: string | null): string {
  if (!iso) return "";
  const options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  try {
    return new Date(iso).toLocaleDateString(hostLocale(), tz ? { ...options, timeZone: tz } : options);
  } catch {
    return new Date(iso).toLocaleDateString(hostLocale(), options);
  }
}

/** Delay in whole minutes (positive = late), or 0. */
export function delayMinutes(actual?: string | null, scheduled?: string | null): number {
  if (!actual || !scheduled) return 0;
  return Math.round((Date.parse(actual) - Date.parse(scheduled)) / 60000);
}

export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

export function distance(meters?: number | null): string {
  if (meters == null) return "";
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function modeLabel(mode: string): string {
  return tOptional(`mode.${mode}`) ?? mode.charAt(0) + mode.slice(1).toLowerCase().replaceAll("_", " ");
}

/** Default colors by mode, used when the route has no color. */
const MODE_COLORS: Record<string, string> = {
  WALK: "#8a8f98",
  BIKE: "#2f9e44",
  RENTAL: "#2f9e44",
  CAR: "#495057",
  TRAM: "#e8590c",
  SUBWAY: "#1c7ed6",
  METRO: "#1c7ed6",
  BUS: "#7048e8",
  COACH: "#5f3dc4",
  FERRY: "#0c8599",
  AIRPLANE: "#343a40",
  HIGHSPEED_RAIL: "#c92a2a",
  LONG_DISTANCE: "#c92a2a",
  NIGHT_RAIL: "#364fc7",
};

export function modeColor(mode: string, routeColor?: string | null): string {
  return routeColor ?? MODE_COLORS[mode] ?? "#2b8a3e";
}

/** Delay badge, empty without delay. */
export function delayBadge(delay: number): string {
  if (delay === 0) return "";
  const sign = delay > 0 ? "+" : "";
  return ` <span class="late">${sign}${delay}</span>`;
}

/** Readable text color on [background]. */
export function textOn(background: string, textColor?: string | null): string {
  if (textColor && textColor.toLowerCase() !== background.toLowerCase()) return textColor;
  const hex = background.replace("#", "");
  if (hex.length !== 6) return "#fff";
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111" : "#fff";
}

/** Line badge, colored like the route, or with the pictogram of the SNCF trains and Île-de-France lines. */
export function lineBadge(
  mode: string,
  line?: string | null,
  color?: string | null,
  textColor?: string | null,
  agency?: string | null,
  trainNumber?: string | null,
): string {
  const sncf = sncfBadge(mode, line, agency, trainNumber);
  if (sncf) return sncf;
  const bg = modeColor(mode, color);
  return `<span class="badge" style="background:${esc(bg)};color:${esc(textOn(bg, textColor))}" title="${esc(modeLabel(mode))}">${esc(line || modeLabel(mode))}</span>`;
}
