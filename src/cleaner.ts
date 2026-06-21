import {
  GpxPoint,
  GpxTrack,
  GpxTrackSegment,
  CleanOptions,
  DEFAULT_CLEAN_OPTIONS,
  PointWithStats,
} from "./types.js";
import { pointDistance, smoothElevation } from "./geometry.js";

export interface CleanResult {
  segments: GpxTrackSegment[];
  stats: CleanStats;
}

export interface CleanStats {
  originalPointCount: number;
  cleanedPointCount: number;
  driftPointsRemoved: number;
  duplicateTimestampsMerged: number;
  pauseSegments: number;
  gapSegments: number;
  interpolatedPoints: number;
}

export function cleanTrack(
  track: GpxTrack,
  options: Partial<CleanOptions> = {},
): CleanResult {
  const opts = { ...DEFAULT_CLEAN_OPTIONS, ...options };
  const stats: CleanStats = {
    originalPointCount: 0,
    cleanedPointCount: 0,
    driftPointsRemoved: 0,
    duplicateTimestampsMerged: 0,
    pauseSegments: 0,
    gapSegments: 0,
    interpolatedPoints: 0,
  };

  let allPoints: GpxPoint[] = [];
  for (const seg of track.segments) {
    allPoints = allPoints.concat(seg.points);
  }
  stats.originalPointCount = allPoints.length;

  let points = mergeDuplicateTimestamps(allPoints, stats);

  points = removeDriftPoints(points, opts.maxSpeedMps, stats);

  points = smoothElevation(points, opts.elevationSmoothingWindow);

  const segments = splitIntoSegments(
    points,
    opts.minPauseSeconds,
    opts.maxGapSeconds,
    stats,
  );

  stats.cleanedPointCount = segments.reduce(
    (sum, seg) => sum + seg.points.length,
    0,
  );

  return {
    segments,
    stats,
  };
}

function mergeDuplicateTimestamps(
  points: GpxPoint[],
  stats: CleanStats,
): GpxPoint[] {
  if (points.length <= 1) return points;

  const result: GpxPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];

    if (prev.time && curr.time && prev.time.getTime() === curr.time.getTime()) {
      const merged: GpxPoint = {
        lat: (prev.lat + curr.lat) / 2,
        lon: (prev.lon + curr.lon) / 2,
        time: prev.time,
      };

      if (prev.ele !== undefined && curr.ele !== undefined) {
        merged.ele = (prev.ele + curr.ele) / 2;
      } else if (prev.ele !== undefined) {
        merged.ele = prev.ele;
      } else if (curr.ele !== undefined) {
        merged.ele = curr.ele;
      }

      if (prev.hr !== undefined && curr.hr !== undefined) {
        merged.hr = Math.round((prev.hr + curr.hr) / 2);
      } else if (prev.hr !== undefined) {
        merged.hr = prev.hr;
      } else if (curr.hr !== undefined) {
        merged.hr = curr.hr;
      }

      result[result.length - 1] = merged;
      stats.duplicateTimestampsMerged++;
    } else {
      result.push(curr);
    }
  }

  return result;
}

function removeDriftPoints(
  points: GpxPoint[],
  maxSpeedMps: number,
  stats: CleanStats,
): GpxPoint[] {
  if (points.length <= 2) return points;

  let result = [...points];
  let totalRemoved = 0;
  const maxPasses = 5;

  for (let pass = 0; pass < maxPasses; pass++) {
    const n = result.length;
    if (n <= 3) break;

    const isDrift = new Array(n).fill(false);
    let removedInPass = 0;

    const speeds = calculateSpeeds(result);

    const windowSize = 11;
    const halfWindow = Math.floor(windowSize / 2);

    for (let i = 1; i < n - 1; i++) {
      if (isDrift[i]) continue;

      const currentSpeed = speeds[i];
      const prev = result[i - 1];
      const curr = result[i];
      const next = result[i + 1];

      let isAbsoluteDrift = false;
      if (prev.time && curr.time) {
        const dt = (curr.time.getTime() - prev.time.getTime()) / 1000;
        if (dt > 0) {
          const dist = pointDistance(prev, curr);
          if (dist / dt > maxSpeedMps) {
            isAbsoluteDrift = true;
          }
        }
      }

      const d1 = pointDistance(prev, curr);
      const d2 = pointDistance(curr, next);
      const dDirect = pointDistance(prev, next);
      const spikeRatio = dDirect > 0 ? (d1 + d2) / dDirect : Infinity;
      const isPointSpike = spikeRatio > 2.5 && d1 > 15 && d2 > 15;

      const windowSpeeds: number[] = [];
      for (
        let j = Math.max(1, i - halfWindow);
        j <= Math.min(n - 1, i + halfWindow);
        j++
      ) {
        if (j !== i) {
          windowSpeeds.push(speeds[j]);
        }
      }

      let isRelativeDrift = false;
      if (windowSpeeds.length >= 5) {
        windowSpeeds.sort((a, b) => a - b);
        const medianSpeed = windowSpeeds[Math.floor(windowSpeeds.length / 2)];
        if (
          medianSpeed > 0.5 &&
          currentSpeed > medianSpeed * 3 &&
          currentSpeed > 3
        ) {
          isRelativeDrift = true;
        }
      }

      if (
        isAbsoluteDrift ||
        (isPointSpike && isRelativeDrift) ||
        (isPointSpike && currentSpeed > 5)
      ) {
        isDrift[i] = true;
        removedInPass++;
      }
    }

    if (removedInPass === 0) break;

    totalRemoved += removedInPass;
    result = result.filter((_, idx) => !isDrift[idx]);
  }

  stats.driftPointsRemoved = totalRemoved;
  return result;
}

function calculateSpeeds(points: GpxPoint[]): number[] {
  const speeds: number[] = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dist = pointDistance(prev, curr);
    let dt = 1;
    if (prev.time && curr.time) {
      dt = Math.max((curr.time.getTime() - prev.time.getTime()) / 1000, 0.1);
    }
    speeds[i] = dist / dt;
  }
  return speeds;
}

function splitIntoSegments(
  points: GpxPoint[],
  minPauseSeconds: number,
  maxGapSeconds: number,
  stats: CleanStats,
): GpxTrackSegment[] {
  if (points.length === 0) return [];

  const segments: GpxTrackSegment[] = [];
  let currentSegment: GpxPoint[] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    if (prev.time && curr.time) {
      const dt = (curr.time.getTime() - prev.time.getTime()) / 1000;

      if (dt > maxGapSeconds) {
        segments.push({ points: currentSegment });
        currentSegment = [curr];
        stats.gapSegments++;
      } else {
        currentSegment.push(curr);
      }
    } else {
      currentSegment.push(curr);
    }
  }

  if (currentSegment.length > 0) {
    segments.push({ points: currentSegment });
  }

  return segments;
}

export function annotatePointsWithStats(
  points: GpxPoint[],
  minPauseSeconds: number,
): PointWithStats[] {
  if (points.length === 0) return [];

  const annotated: PointWithStats[] = [];

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    let distanceFromPrev = 0;
    let timeFromPrev = 0;
    let speedMps = 0;
    let isPause = false;

    if (i > 0) {
      const prev = points[i - 1];
      distanceFromPrev = pointDistance(prev, point);

      if (prev.time && point.time) {
        timeFromPrev = (point.time.getTime() - prev.time.getTime()) / 1000;
        if (timeFromPrev > 0) {
          speedMps = distanceFromPrev / timeFromPrev;
        }
      }

      if (timeFromPrev >= minPauseSeconds && distanceFromPrev < 10) {
        isPause = true;
      }
    }

    annotated.push({
      ...point,
      distanceFromPrev,
      timeFromPrev,
      speedMps,
      isPause,
      isDrift: false,
      isInterpolated: false,
      segmentId: 0,
    });
  }

  return annotated;
}

export function interpolateMissingPoints(
  points: GpxPoint[],
  maxGapSeconds: number,
): { points: GpxPoint[]; interpolatedCount: number } {
  if (points.length <= 1) return { points, interpolatedCount: 0 };

  const result: GpxPoint[] = [points[0]];
  let interpolatedCount = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    if (prev.time && curr.time) {
      const dt = (curr.time.getTime() - prev.time.getTime()) / 1000;

      if (dt > 1 && dt <= maxGapSeconds) {
        const steps = Math.ceil(dt);
        for (let s = 1; s < steps; s++) {
          const ratio = s / steps;
          const interpolated: GpxPoint = {
            lat: prev.lat + (curr.lat - prev.lat) * ratio,
            lon: prev.lon + (curr.lon - prev.lon) * ratio,
            time: new Date(
              prev.time.getTime() +
                (curr.time.getTime() - prev.time.getTime()) * ratio,
            ),
          };

          if (prev.ele !== undefined && curr.ele !== undefined) {
            interpolated.ele = prev.ele + (curr.ele - prev.ele) * ratio;
          }

          if (prev.hr !== undefined && curr.hr !== undefined) {
            interpolated.hr = Math.round(prev.hr + (curr.hr - prev.hr) * ratio);
          }

          result.push(interpolated);
          interpolatedCount++;
        }
      }
    }

    result.push(curr);
  }

  return { points: result, interpolatedCount };
}
