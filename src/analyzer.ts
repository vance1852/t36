import {
  GpxTrack,
  GpxTrackSegment,
  TrackAnalysis,
  SegmentAnalysis,
  BestSplit,
  ActivityType,
  STANDARD_SPLITS,
  CleanOptions,
  DEFAULT_CLEAN_OPTIONS,
} from "./types.js";
import {
  pointDistance,
  calculateElevationGain,
  cumulativeDistances,
} from "./geometry.js";
import { annotatePointsWithStats } from "./cleaner.js";

export function analyzeTrack(
  track: GpxTrack,
  options: Partial<CleanOptions> = {},
): TrackAnalysis {
  const opts = { ...DEFAULT_CLEAN_OPTIONS, ...options };
  const activityType = detectActivityType(track);

  const segmentAnalyses: SegmentAnalysis[] = [];
  let totalDistance = 0;
  let totalMovingTime = 0;
  let totalPauseTime = 0;
  let totalElevationGain = 0;
  let totalElevationLoss = 0;
  let maxElevation = -Infinity;
  let minElevation = Infinity;
  let allPoints: GpxTrackSegment["points"] = [];

  for (let i = 0; i < track.segments.length; i++) {
    const seg = track.segments[i];
    const segAnalysis = analyzeSegment(seg, i, opts);
    segmentAnalyses.push(segAnalysis);

    totalDistance += segAnalysis.distance;
    totalMovingTime += segAnalysis.movingTime;
    totalPauseTime += segAnalysis.pauseTime;
    totalElevationGain += segAnalysis.elevationGain;
    totalElevationLoss += segAnalysis.elevationLoss;

    if (seg.points.length > 0) {
      allPoints = allPoints.concat(seg.points);
      const elevStats = calculateElevationGain(
        seg.points,
        opts.minElevationGainThreshold,
      );
      if (elevStats.max > maxElevation) maxElevation = elevStats.max;
      if (elevStats.min < minElevation) minElevation = elevStats.min;
    }
  }

  const totalTime = totalMovingTime + totalPauseTime;
  const avgSpeedMps = totalMovingTime > 0 ? totalDistance / totalMovingTime : 0;
  const avgPaceMinPerKm =
    avgSpeedMps > 0 ? paceFromSpeed(avgSpeedMps) : Infinity;

  const bestSplits = findBestSplits(allPoints, STANDARD_SPLITS);

  const bestPaceMinPerKm = Object.values(bestSplits).reduce(
    (best, split) => (split.paceMinPerKm < best ? split.paceMinPerKm : best),
    Infinity,
  );

  let maxSpeedMps = 0;
  if (allPoints.length > 1) {
    const annotated = annotatePointsWithStats(allPoints, opts.minPauseSeconds);
    for (let i = 1; i < annotated.length; i++) {
      const pt = annotated[i];
      if (!pt.isPause && pt.speedMps > maxSpeedMps) {
        maxSpeedMps = pt.speedMps;
      }
    }
  }
  const fastestPaceMinPerKm = maxSpeedMps > 0 ? paceFromSpeed(maxSpeedMps) : 0;

  const startPoint = track.segments[0]?.points[0];
  const endPoint =
    track.segments[track.segments.length - 1]?.points[
      track.segments[track.segments.length - 1].points.length - 1
    ];

  return {
    totalDistance,
    movingDistance: totalDistance,
    totalTime,
    movingTime: totalMovingTime,
    pauseTime: totalPauseTime,
    avgSpeedMps,
    avgPaceMinPerKm,
    bestPaceMinPerKm: fastestPaceMinPerKm,
    totalElevationGain,
    totalElevationLoss,
    maxElevation: isFinite(maxElevation) ? maxElevation : 0,
    minElevation: isFinite(minElevation) ? minElevation : 0,
    segments: segmentAnalyses,
    bestSplits,
    startPoint,
    endPoint,
    activityType,
  };
}

function analyzeSegment(
  segment: GpxTrackSegment,
  id: number,
  options: CleanOptions,
): SegmentAnalysis {
  const points = segment.points;
  if (points.length === 0) {
    return {
      id,
      distance: 0,
      movingTime: 0,
      pauseTime: 0,
      elevationGain: 0,
      elevationLoss: 0,
      start: new Date(0),
      end: new Date(0),
    };
  }

  const annotated = annotatePointsWithStats(points, options.minPauseSeconds);

  let distance = 0;
  let movingTime = 0;
  let pauseTime = 0;

  for (let i = 1; i < annotated.length; i++) {
    const pt = annotated[i];
    distance += pt.distanceFromPrev;

    if (pt.isPause) {
      pauseTime += pt.timeFromPrev;
    } else {
      movingTime += pt.timeFromPrev;
    }
  }

  const elevStats = calculateElevationGain(
    points,
    options.minElevationGainThreshold,
  );

  const start = points[0].time || new Date(0);
  const end = points[points.length - 1].time || new Date(0);

  return {
    id,
    distance,
    movingTime,
    pauseTime,
    elevationGain: elevStats.gain,
    elevationLoss: elevStats.loss,
    start,
    end,
  };
}

function findBestSplits(
  points: GpxTrackSegment["points"],
  splitDistances: number[],
): Record<string, BestSplit> {
  const result: Record<string, BestSplit> = {};

  if (points.length < 2) {
    for (const dist of splitDistances) {
      result[formatSplitLabel(dist)] = {
        distance: dist,
        duration: 0,
        paceMinPerKm: Infinity,
        startIndex: 0,
        endIndex: 0,
      };
    }
    return result;
  }

  const cumDist = cumulativeDistances(points);
  const totalDist = cumDist[cumDist.length - 1];

  for (const targetDist of splitDistances) {
    if (totalDist < targetDist) {
      result[formatSplitLabel(targetDist)] = {
        distance: targetDist,
        duration: 0,
        paceMinPerKm: Infinity,
        startIndex: 0,
        endIndex: 0,
      };
      continue;
    }

    let bestDuration = Infinity;
    let bestStartIdx = 0;
    let bestEndIdx = 0;

    for (let start = 0; start < cumDist.length; start++) {
      const targetEndDist = cumDist[start] + targetDist;

      let end = start + 1;
      while (end < cumDist.length && cumDist[end] < targetEndDist) {
        end++;
      }

      if (end >= cumDist.length) break;

      const startTime = points[start].time;
      const endTime = points[end].time;

      if (startTime && endTime) {
        const duration = (endTime.getTime() - startTime.getTime()) / 1000;

        const actualDist = cumDist[end] - cumDist[start];
        const scaledDuration = duration * (targetDist / actualDist);

        if (scaledDuration < bestDuration) {
          bestDuration = scaledDuration;
          bestStartIdx = start;
          bestEndIdx = end;
        }
      }
    }

    const pace =
      bestDuration > 0 ? bestDuration / 60 / (targetDist / 1000) : Infinity;

    result[formatSplitLabel(targetDist)] = {
      distance: targetDist,
      duration: isFinite(bestDuration) ? bestDuration : 0,
      paceMinPerKm: isFinite(pace) ? pace : 0,
      startIndex: bestStartIdx,
      endIndex: bestEndIdx,
    };
  }

  return result;
}

function formatSplitLabel(distance: number): string {
  if (distance === 1000) return "1km";
  if (distance === 5000) return "5km";
  if (distance === 10000) return "10km";
  if (distance === 21097.5) return "半马";
  if (distance === 42195) return "全马";
  return `${distance}m`;
}

export function paceFromSpeed(speedMps: number): number {
  if (speedMps <= 0) return Infinity;
  return 1000 / speedMps / 60;
}

export function formatPace(paceMinPerKm: number): string {
  if (!isFinite(paceMinPerKm) || paceMinPerKm === 0) return "--:--";
  const minutes = Math.floor(paceMinPerKm);
  const seconds = Math.round((paceMinPerKm - minutes) * 60);
  return `${minutes}'${seconds.toString().padStart(2, "0")}"`;
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function detectActivityType(track: GpxTrack): ActivityType {
  if (track.type) {
    const type = track.type.toLowerCase();
    if (type.includes("run") || type.includes("跑步")) return "running";
    if (
      type.includes("bike") ||
      type.includes("cycle") ||
      type.includes("骑行")
    )
      return "cycling";
  }

  if (track.name) {
    const name = track.name.toLowerCase();
    if (name.includes("run") || name.includes("跑步")) return "running";
    if (name.includes("bike") || name.includes("ride") || name.includes("骑行"))
      return "cycling";
  }

  return "unknown";
}

export function calculateTrainingLoad(
  distance: number,
  elevationGain: number,
  movingTime: number,
): number {
  const distanceKm = distance / 1000;
  const elevationKm = elevationGain / 1000;
  const load = distanceKm + elevationKm * 10;
  return Math.max(load, (movingTime / 3600) * 6);
}
