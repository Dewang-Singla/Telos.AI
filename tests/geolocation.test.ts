import { describe, expect, it, vi } from "vitest";
import {
  getDeviceLocation,
  hasLocationPermission,
} from "../src/lib/geolocation";

describe("device location", () => {
  it.each([
    [1, "Allow location"],
    [2, "couldn’t determine"],
    [3, "timed out"],
  ])("distinguishes geolocation error %s", async (code, message) => {
    const source: Pick<Geolocation, "getCurrentPosition"> = {
      getCurrentPosition(_success, failure) {
        failure?.({ code } as GeolocationPositionError);
      },
    };
    await expect(getDeviceLocation(source, true)).rejects.toThrow(
      message as string,
    );
    if (code !== 1)
      await expect(getDeviceLocation(source, true)).rejects.not.toThrow(
        /denied|Allow location/,
      );
  });
  it("only returns coordinates, with a finite timeout and a short cache window", async () => {
    const read = vi.fn<Geolocation["getCurrentPosition"]>((success) =>
      success({
        coords: { latitude: 12.97, longitude: 77.59, accuracy: 20 },
        timestamp: Date.now(),
      } as GeolocationPosition),
    );
    expect(await getDeviceLocation({ getCurrentPosition: read }, true)).toEqual(
      { latitude: 12.97, longitude: 77.59 },
    );
    expect(read).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
  it("does not attempt detection from an insecure context", async () => {
    const read = vi.fn();
    await expect(
      getDeviceLocation({ getCurrentPosition: read }, false),
    ).rejects.toThrow("HTTPS or localhost");
    expect(read).not.toHaveBeenCalled();
  });
  it("handles browsers without geolocation", async () => {
    await expect(getDeviceLocation(undefined, true)).rejects.toThrow(
      "unavailable in this browser",
    );
  });
  it("does not accept invalid coordinates from a location source", async () => {
    const source: Pick<Geolocation, "getCurrentPosition"> = {
      getCurrentPosition(success) {
        success({
          coords: { latitude: NaN, longitude: 181 },
        } as GeolocationPosition);
      },
    };
    await expect(getDeviceLocation(source, true)).rejects.toThrow(
      "couldn’t determine",
    );
  });
  it.each(["prompt", "denied", "granted"])(
    "auto-detection checks permission %s without asking for a new grant",
    async (state) => {
      const query = vi.fn().mockResolvedValue({ state });
      expect(await hasLocationPermission({ query })).toBe(state === "granted");
      expect(query).toHaveBeenCalledWith({ name: "geolocation" });
    },
  );
  it("leaves detection to the explicit button if permission lookup is unsupported", async () => {
    const query = vi
      .fn()
      .mockRejectedValue(new Error("Unsupported permission"));
    expect(await hasLocationPermission({ query })).toBe(false);
  });
});
