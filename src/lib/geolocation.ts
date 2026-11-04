export type DeviceCoordinates = { latitude: number; longitude: number };
type PositionSource = Pick<Geolocation, "getCurrentPosition">;
type PermissionSource = Pick<Permissions, "query">;

export async function hasLocationPermission(
  permissions: PermissionSource | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.permissions,
): Promise<boolean> {
  try {
    return Boolean(
      permissions &&
      (await permissions.query({ name: "geolocation" })).state === "granted",
    );
  } catch {
    return false;
  }
}

export function getDeviceLocation(
  geolocation: PositionSource | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.geolocation,
  secure = typeof window !== "undefined" && window.isSecureContext,
): Promise<DeviceCoordinates> {
  if (!secure)
    return Promise.reject(
      new Error("Open Telos over HTTPS or localhost to use device location."),
    );
  if (!geolocation)
    return Promise.reject(
      new Error(
        "Location is unavailable in this browser. Enter a city instead.",
      ),
    );
  return new Promise((resolve, reject) => {
    try {
      geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 ||
            latitude > 90 ||
            longitude < -180 ||
            longitude > 180
          ) {
            reject(
              new Error(
                "Your device couldn’t determine a location. Try again or enter a city.",
              ),
            );
            return;
          }
          resolve({ latitude, longitude });
        },
        (error) => {
          const message =
            error.code === 1
              ? "Allow location for this site in your browser and device settings, or enter a city."
              : error.code === 3
                ? "Location timed out. Try again or enter a city."
                : "Your device couldn’t determine a location. Try again or enter a city.";
          reject(new Error(message));
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      );
    } catch {
      reject(
        new Error(
          "Location is unavailable in this browser. Enter a city instead.",
        ),
      );
    }
  });
}
