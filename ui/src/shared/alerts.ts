// Service alerts (disruptions, works...) of the legs and stop times: a mark on the rows, the details in lists.
import { day, esc, time } from "./format";
import { t } from "./i18n";
import { warning } from "./icons";
import type { AlertDto } from "./types";

/** Alerts of a leg or stop time: its [indexes] in the [table] of the result. */
export const alertsOf = (table: AlertDto[] | undefined, indexes: number[] | undefined): AlertDto[] =>
  (indexes ?? []).flatMap((i) => (table?.[i] ? [table[i]] : []));

/** An alert saying the service is interrupted: the itineraries are not routed around it. */
export const isSevere = (alert: AlertDto): boolean => alert.effect === "NO_SERVICE";

const severity = (alerts: AlertDto[]) => (alerts.some(isSevere) ? "severe" : "");

/** Warning sign of a row with [alerts], their headers as tooltip; empty without alerts. */
export function alertMark(alerts: AlertDto[]): string {
  if (!alerts.length) return "";
  const headers = alerts.map((a) => a.header).join("\n");
  const label = t("alerts.alert") + ": " + headers;
  return `<span class="alert-mark ${severity(alerts)}" role="img" title="${esc(headers)}" aria-label="${esc(label)}">${warning}</span>`;
}

/** Headers of the [alerts] of a single departure of a board, under its row; empty without alerts. */
export function alertLine(alerts: AlertDto[]): string {
  if (!alerts.length) return "";
  const lines = alerts.map((a) => `<span title="${esc(a.description ?? a.header)}">${esc(a.header)}</span>`).join("");
  return `<div class="alert-line ${severity(alerts)}">${warning}<span>${lines}</span></div>`;
}

/** End of the impact of an alert: its day and time. */
const until = (end: string, tz?: string): string => t("alerts.until", { date: `${day(end, tz)} ${time(end, tz)}` });

/**
 * An alert: its header, after its [subject] if any (the trains it is about), and its details (description, end, link)
 * when unfolded, from the start when [open].
 */
function alertItem(alert: AlertDto, tz: string | undefined, open: boolean, subject?: string): string {
  const about = subject ? `<span class="alert-subject">${esc(subject)}</span> — ` : "";
  const header = `${warning}<span>${about}${esc(alert.header)}</span>`;
  const link = alert.url
    ? `<p><a href="${esc(alert.url)}" data-link target="_blank" rel="noopener noreferrer">${esc(alert.linkText ?? t("alerts.more"))}</a></p>`
    : "";
  // a link ending the description ("veuillez cliquer sur :") right under it
  const details = [
    alert.description ? `<p class="alert-description">${esc(alert.description)}</p>` : "",
    alert.linkText ? link : "",
    alert.end ? `<p class="muted">${esc(until(alert.end, tz))}</p>` : "",
    alert.linkText ? "" : link,
  ].join("");
  const unfolded = open ? " open" : "";
  const body = details ? `<details${unfolded}><summary>${header}</summary>${details}</details>` : `<div class="alert-header">${header}</div>`;
  return `<li class="alert ${isSevere(alert) ? "severe" : ""}">${body}</li>`;
}

/**
 * List of [alerts], each unfolded on a click, a lone one unfolded already: nothing hints to click it; empty without alerts.
 * [subjects] are those of the alerts, by position.
 */
export function alertList(alerts: AlertDto[], tz?: string, subjects?: (string | undefined)[]): string {
  const open = alerts.length === 1;
  return alerts.length ? `<ul class="alerts">${alerts.map((a, i) => alertItem(a, tz, open, subjects?.[i])).join("")}</ul>` : "";
}

/** All the [alerts] of a result, folded under their count: a board shows many lines. [subjects] are those of the alerts. */
export function alertBanner(alerts: AlertDto[] | undefined, tz?: string, subjects?: (string | undefined)[]): string {
  if (!alerts?.length) return "";
  return `<details class="alert-banner ${severity(alerts)}"><summary>${warning}<span>${t("alerts.title")} (${alerts.length})</span></summary>${alertList(alerts, tz, subjects)}</details>`;
}
