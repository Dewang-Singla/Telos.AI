"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDeviceLocation,
  hasLocationPermission,
  type DeviceCoordinates,
} from "@/lib/geolocation";

export function useDeviceLocation() {
  const [coordinates, setValue] = useState<DeviceCoordinates | null>(null);
  const [locating, setLocating] = useState(false),
    [error, setError] = useState("");
  const operation = useRef(0);
  const invalidate = useCallback(() => {
    operation.current++;
  }, []);
  useEffect(() => invalidate, [invalidate]);
  const cancelLocation = useCallback(() => {
    invalidate();
    setLocating(false);
    setError("");
  }, [invalidate]);
  const setCoordinates = useCallback(
    (value: DeviceCoordinates | null) => {
      cancelLocation();
      setValue(value);
    },
    [cancelLocation],
  );
  const requestLocation = useCallback(async (onlyIfAllowed = false) => {
    const current = ++operation.current;
    if (onlyIfAllowed && !(await hasLocationPermission())) return null;
    if (current !== operation.current) return null;
    setLocating(true);
    setError("");
    try {
      const position = await getDeviceLocation();
      if (current !== operation.current) return null;
      setValue(position);
      return position;
    } catch (e) {
      if (current === operation.current) setError((e as Error).message);
      return null;
    } finally {
      if (current === operation.current) setLocating(false);
    }
  }, []);
  return {
    coordinates,
    setCoordinates,
    locating,
    error,
    requestLocation,
    cancelLocation,
  };
}
