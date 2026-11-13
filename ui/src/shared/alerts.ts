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
  return `<span class="alert-mark ${severity(alerts)}" role="img" title="${esc(headers)}" aria-label="${esc(`${t("alerts.alert")}: ${headers}`)}">${warning}</span>`;
}

/** End of the impact of an alert: its day and time. */
const until = (end: string, tz?: string): string => t("alerts.until", { date: `${day(end, tz)} ${time(end, tz)}` });

/** An alert: its header, and its details (description, end, link) when unfolded. */
function alertItem(alert: AlertDto, tz?: string): string {
  const header = `${warning}<span>${esc(alert.header)}</span>`;
  const details = [
    alert.description ? `<p class="alert-description">${esc(alert.description)}</p>` : "",
    alert.end ? `<p class="muted">${esc(until(alert.end, tz))}</p>` : "",
    alert.url ? `<p><a href="${esc(alert.url)}" data-link target="_blank" rel="noopener noreferrer">${t("alerts.more")}</a></p>` : "",
  ].join("");
  const body = details ? `<details><summary>${header}</summary>${details}</details>` : `<div class="alert-header">${header}</div>`;
  return `<li class="alert ${isSevere(alert) ? "severe" : ""}">${body}</li>`;
}

/** List of [alerts], each unfolded on a click; empty without alerts. */
export function alertList(alerts: AlertDto[], tz?: string): string {
  return alerts.length ? `<ul class="alerts">${alerts.map((a) => alertItem(a, tz)).join("")}</ul>` : "";
}

/** All the [alerts] of a result, folded under their count: a board shows many lines. */
export function alertBanner(alerts: AlertDto[] | undefined, tz?: string): string {
  if (!alerts?.length) return "";
  return `<details class="alert-banner ${severity(alerts)}"><summary>${warning}<span>${t("alerts.title")} (${alerts.length})</span></summary>${alertList(alerts, tz)}</details>`;
}
