// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentPosition, useLocation } from "./location";

const PERMISSION_DENIED = 1;
const TIMEOUT = 3;

/** Fake geolocation: [succeed] / [fail] answer the current watch. */
function fakeGeolocation() {
  let success: PositionCallback | undefined;
  let failure: PositionErrorCallback | null | undefined;
  const geolocation = {
    watchPosition: vi.fn((onSuccess: PositionCallback, onError?: PositionErrorCallback | null) => {
      success = onSuccess;
      failure = onError;
      return 7;
    }),
    clearWatch: vi.fn(),
  };
  Object.defineProperty(globalThis.navigator, "geolocation", { value: geolocation, configurable: true });
  return {
    geolocation,
    succeed: (latitude: number, longitude: number) =>
      act(() => success?.({ coords: { latitude, longitude, accuracy: 20 } } as GeolocationPosition)),
    fail: (code: number) =>
      act(() => failure?.({ code, PERMISSION_DENIED } as GeolocationPositionError)),
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  Reflect.deleteProperty(globalThis.navigator, "geolocation");
});

describe("useLocation", () => {
  it("is off until enabled, then watches the position, remembered in the browser", () => {
    const fake = fakeGeolocation();
    const { result, unmount } = renderHook(() => useLocation());
    expect(result.current.status).toBe("off");
    expect(fake.geolocation.watchPosition).not.toHaveBeenCalled();

    act(() => result.current.toggle());
    expect(result.current.status).toBe("locating");
    fake.succeed(45.7605, 4.8597);
    expect(result.current.status).toBe("on");
    expect(currentPosition()).toEqual({ lat: 45.7605, lon: 4.8597, accuracy: 20 });
    expect(localStorage.getItem("motis.location")).toBe("on");

    unmount();
    expect(fake.geolocation.clearWatch).toHaveBeenCalledWith(7);
    expect(currentPosition()).toBeNull();
    // enabled again on the next visit
    expect(renderHook(() => useLocation()).result.current.status).toBe("locating");
  });

  it("stops when the browser refuses, and forgets the position when disabled", () => {
    const fake = fakeGeolocation();
    const { result } = renderHook(() => useLocation());
    act(() => result.current.toggle());
    fake.fail(PERMISSION_DENIED);
    expect(result.current.status).toBe("denied");
    expect(localStorage.getItem("motis.location")).toBeNull();

    act(() => result.current.toggle());
    fake.succeed(48.85, 2.35);
    fake.fail(TIMEOUT);
    expect(result.current.status).toBe("unavailable");
    expect(currentPosition()).toBeNull();
    act(() => result.current.toggle());
    expect(result.current.status).toBe("off");
  });

  it("is unavailable without geolocation", () => {
    const { result } = renderHook(() => useLocation());
    act(() => result.current.toggle());
    expect(result.current.status).toBe("unavailable");
  });
});
