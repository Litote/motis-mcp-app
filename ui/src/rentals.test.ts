import { describe, expect, it } from "vitest";
import { $, fixture, loadView } from "./test/host";
import type { RentalsResult } from "./shared/types";

const providers = () => [...document.querySelectorAll("label")].map((el) => el.textContent!.replace(/\s+/g, " ").trim());

describe("rentals view", () => {
  it("shows the providers of the area, with their stations and vehicles", async () => {
    const app = await loadView("rentals");
    await app.toolResult({}, fixture("rentals"));

    expect($("#title").textContent).toBe("Shared mobility · 48.8586,2.3470 (1.5 km)");
    expect($("#subtitle").textContent).toBe("2 provider(s) · 2 station(s) or parking spot(s) · 1 free-floating vehicle(s)");
    expect(providers()).toEqual([
      "Lime Paris Proper bike · 0 st. · 1 veh. · 5556 in its whole area",
      "Paris bike · 2 st. · 0 veh.",
    ]);
  });

  it("hides and shows a provider", async () => {
    const app = await loadView("rentals");
    await app.toolResult({}, fixture("rentals"));
    const checkbox = () => document.querySelector<HTMLInputElement>("input[data-provider='fr-gbfs-paris-1']")!;

    checkbox().checked = false;
    checkbox().dispatchEvent(new Event("change", { bubbles: true }));
    expect(checkbox().checked).toBe(false);

    checkbox().checked = true;
    checkbox().dispatchEvent(new Event("change", { bubbles: true }));
    expect(checkbox().checked).toBe(true);
  });

  it("tells when the closest only are shown, or when there is no provider", async () => {
    const app = await loadView("rentals");
    const data = fixture<RentalsResult>("rentals");
    await app.toolResult({}, { ...data, totalStations: 40 });
    expect($("#subtitle").textContent).toMatch(/ \(closest shown\)$/);

    await app.toolResult({}, { ...data, providers: [], stations: [], vehicles: [], totalStations: 0, totalVehicles: 0 });
    expect($("#content").textContent).toContain("No shared mobility provider in this area.");
  });

  it("follows the theme of the host", async () => {
    const app = await loadView("rentals");
    app.onhostcontextchanged?.({ theme: "light" });
    expect($(".map").classList.contains("dark-tiles")).toBe(false);
    app.onhostcontextchanged?.({ theme: "dark" });
    expect($(".map").classList.contains("dark-tiles")).toBe(true);
  });
});
