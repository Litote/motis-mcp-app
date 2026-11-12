import { describe, expect, it } from "vitest";
import { $, fixture, loadView } from "./test/host";
import type { RentalsResult } from "./shared/types";

const providers = () => [...document.querySelectorAll("label")].map((el) => el.textContent!.replace(/\s+/g, " ").trim());

describe("rentals view", () => {
  it("shows the providers of the area, with their stations and vehicles", async () => {
    const app = await loadView("rentals");
    await app.toolResult({}, fixture("rentals"));

    expect($("#title").textContent).toBe("Shared mobility · 48.8586,2.3470 (1.5 km)");
    expect($("#subtitle").textContent).toBe("2 providers · 2 stations or parking spots · 1 free-floating vehicle");
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

  it("keeps the providers and the selected item when a provider is hidden", async () => {
    const app = await loadView("rentals");
    await app.toolResult({}, fixture("rentals"));
    const checkbox = document.querySelector<HTMLInputElement>("input[data-provider='fr-gbfs-paris-1']")!;
    $("#nearby li[data-key='station:6245']").click();

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect(checkbox.isConnected).toBe(true);
    expect([...document.querySelectorAll<HTMLElement>("#nearby li")].map((li) => li.dataset.key)).toEqual([
      "station:82328045",
      "station:6245",
    ]);
    expect($("#nearby li.selected").dataset.key).toBe("station:6245");

    document.querySelector<HTMLInputElement>("input[data-provider='fr-velib-velos-et-bornes-disponibilite-temps-reel']")!.click();
    expect(document.querySelector("#nearby li.selected")).toBeNull();
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

  it("lists the stations and vehicles, closest or available first, and shows the one clicked", async () => {
    const app = await loadView("rentals");
    const data = fixture<RentalsResult>("rentals");
    data.vehicles[0].available = false;
    await app.toolResult({}, data);
    const nearby = () => [...document.querySelectorAll("#nearby li")].map((li) => li.textContent!.replace(/\s+/g, " ").trim());

    expect(nearby()).toEqual([
      "Victoria - Place du ChateletParis · 17 vehicles 68 m",
      "Lime Paris Proper · bikeelectric assist · unavailable 1 km",
      "Ventadour - OpéraParis · 13 vehicles 1.3 km",
    ]);

    $("button[data-sort=availability]").click();
    expect(nearby()[2]).toMatch(/^Lime Paris Proper/);
    expect($("button[data-sort=availability]").getAttribute("aria-pressed")).toBe("true");

    $("#nearby li[data-key='station:6245']").click();
    expect($("#nearby li.selected").dataset.key).toBe("station:6245");
    expect(document.querySelector(".leaflet-tooltip")?.textContent).toContain("Ventadour - Opéra");

    $("#nearby li[data-key='station:82328045']").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect($("#nearby li.selected").dataset.key).toBe("station:82328045");
  });
});
