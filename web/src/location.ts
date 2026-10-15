/**
 * Position of the user (opt-in): watched while enabled, and given to the model in the system prompt, so that it can
 * plan from "here" (plan_journey 'position') or search around the user.
 */
import { useCallback, useEffect, useState } from "react";

export interface UserPosition {
  lat: number;
  lon: number;
  /** Radius of the uncertainty, in meters. */
  accuracy: number;
}

export type LocationStatus = "off" | "locating" | "on" | "denied" | "unavailable";

const ENABLED_KEY = "motis.location";

/** Last known position, null when disabled or not located yet: read by the agent at each run. */
let current: UserPosition | null = null;

export const currentPosition = (): UserPosition | null => current;

function storedEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "on";
  } catch {
    return false;
  }
}

function storeEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, "on");
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    // not remembered: asked again on the next visit
  }
}

/** `lat,lon` rounded to about 10 m: precise enough for transit, as expected by the tools. */
export const formatPosition = (position: UserPosition): string =>
  `${position.lat.toFixed(4)},${position.lon.toFixed(4)}`;

/** Watches the position while enabled: the choice is remembered in this browser. */
export function useLocation(): { status: LocationStatus; toggle(): void } {
  const [enabled, setEnabled] = useState(storedEnabled);
  const [status, setStatus] = useState<LocationStatus>("off");

  useEffect(() => {
    if (!enabled) {
      // a refusal stays shown until the user tries again
      setStatus((was) => (was === "denied" ? was : "off"));
      return;
    }
    const geolocation = globalThis.navigator?.geolocation;
    if (!geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("locating");
    const watch = geolocation.watchPosition(
      ({ coords }) => {
        current = { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy };
        setStatus("on");
      },
      (error) => {
        current = null;
        if (error.code === error.PERMISSION_DENIED) {
          // refused in the browser: not asked again until the user enables it
          storeEnabled(false);
          setEnabled(false);
          setStatus("denied");
        } else {
          setStatus("unavailable");
        }
      },
      { maximumAge: 60_000, timeout: 30_000 },
    );
    return () => {
      geolocation.clearWatch(watch);
      current = null;
    };
  }, [enabled]);

  const toggle = useCallback(() => {
    setEnabled((was) => {
      storeEnabled(!was);
      return !was;
    });
  }, []);

  return { status, toggle };
}
