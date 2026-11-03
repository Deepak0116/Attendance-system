export interface Coords {
  latitude: number
  longitude: number
  accuracy: number
}

/**
 * Asks the browser for the current position. Only ever called from an explicit user action
 * (START WFH / VERIFY LOCATION) - there is no watchPosition and no background capture.
 */
export function getCurrentPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Your browser does not support location services. Please use a modern browser such as Chrome, Edge or Firefox.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error('Location permission is required to verify your WFH attendance. Please enable location access in your browser and try again.'))
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          reject(new Error('Your location is currently unavailable. Check that GPS / location services are on and try again.'))
        } else if (err.code === err.TIMEOUT) {
          reject(new Error('Getting your location timed out. Please move to an area with better signal and try again.'))
        } else {
          reject(new Error('Unable to read your location. Please try again.'))
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  })
}
