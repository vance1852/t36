import { GpxPoint } from "./types.js";

export const EARTH_RADIUS_METERS = 6371000;

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function pointDistance(p1: GpxPoint, p2: GpxPoint): number {
  return haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon);
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

export function smoothElevation(
  points: GpxPoint[],
  windowSize: number = 5,
): GpxPoint[] {
  if (points.length === 0 || windowSize <= 1) return points;

  const halfWindow = Math.floor(windowSize / 2);
  return points.map((point, index) => {
    if (point.ele === undefined) return point;

    const start = Math.max(0, index - halfWindow);
    const end = Math.min(points.length, index + halfWindow + 1);
    let sum = 0;
    let count = 0;

    for (let i = start; i < end; i++) {
      const ele = points[i].ele;
      if (ele !== undefined) {
        sum += ele;
        count++;
      }
    }

    if (count === 0) return point;

    return {
      ...point,
      ele: sum / count,
    };
  });
}

export function calculateElevationGain(
  points: GpxPoint[],
  threshold: number = 3,
): { gain: number; loss: number; max: number; min: number } {
  if (points.length === 0) {
    return { gain: 0, loss: 0, max: 0, min: 0 };
  }

  let totalGain = 0;
  let totalLoss = 0;
  let maxElev = -Infinity;
  let minElev = Infinity;
  let lastValidElev: number | undefined;

  for (const point of points) {
    if (point.ele === undefined) continue;

    if (point.ele > maxElev) maxElev = point.ele;
    if (point.ele < minElev) minElev = point.ele;

    if (lastValidElev !== undefined) {
      const diff = point.ele - lastValidElev;
      if (diff > threshold) {
        totalGain += diff;
        lastValidElev = point.ele;
      } else if (diff < -threshold) {
        totalLoss += Math.abs(diff);
        lastValidElev = point.ele;
      }
    } else {
      lastValidElev = point.ele;
    }
  }

  if (maxElev === -Infinity) maxElev = 0;
  if (minElev === Infinity) minElev = 0;

  return {
    gain: totalGain,
    loss: totalLoss,
    max: maxElev,
    min: minElev,
  };
}

export function cumulativeDistances(points: GpxPoint[]): number[] {
  const distances: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + pointDistance(points[i - 1], points[i]));
  }
  return distances;
}
