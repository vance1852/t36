export interface GpxPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: Date;
  hr?: number;
  cad?: number;
}

export interface GpxTrackSegment {
  points: GpxPoint[];
}

export interface GpxTrack {
  name?: string;
  type?: string;
  segments: GpxTrackSegment[];
}

export interface GpxMetadata {
  name?: string;
  time?: Date;
  desc?: string;
}

export interface GpxData {
  metadata?: GpxMetadata;
  tracks: GpxTrack[];
  waypoints?: GpxPoint[];
}

export interface CleanOptions {
  maxSpeedMps: number;
  minPauseSeconds: number;
  maxGapSeconds: number;
  elevationSmoothingWindow: number;
  minElevationGainThreshold: number;
}

export interface PointWithStats extends GpxPoint {
  distanceFromPrev: number;
  timeFromPrev: number;
  speedMps: number;
  isPause: boolean;
  isDrift: boolean;
  isInterpolated: boolean;
  segmentId: number;
}

export interface TrackAnalysis {
  totalDistance: number;
  movingDistance: number;
  totalTime: number;
  movingTime: number;
  pauseTime: number;
  avgSpeedMps: number;
  avgPaceMinPerKm: number;
  bestPaceMinPerKm: number;
  totalElevationGain: number;
  totalElevationLoss: number;
  maxElevation: number;
  minElevation: number;
  segments: SegmentAnalysis[];
  bestSplits: Record<string, BestSplit>;
  startPoint?: GpxPoint;
  endPoint?: GpxPoint;
  activityType: ActivityType;
}

export interface SegmentAnalysis {
  id: number;
  distance: number;
  movingTime: number;
  pauseTime: number;
  elevationGain: number;
  elevationLoss: number;
  start: Date;
  end: Date;
}

export interface BestSplit {
  distance: number;
  duration: number;
  paceMinPerKm: number;
  startIndex: number;
  endIndex: number;
}

export type ActivityType = "running" | "cycling" | "unknown";

export interface WeeklyStats {
  weekStart: string;
  weekEnd: string;
  distance: number;
  duration: number;
  elevationGain: number;
  activityCount: number;
  trainingLoad: number;
  monotony: number;
}

export interface TrainingSummary {
  totalActivities: number;
  totalDistance: number;
  totalDuration: number;
  totalElevationGain: number;
  avgDistancePerActivity: number;
  avgDurationPerActivity: number;
  weeklyStats: WeeklyStats[];
  overallMonotony: number;
  weeklyIncreaseRisk: string;
}

export interface ActivityRecord {
  fileName: string;
  name?: string;
  type: ActivityType;
  startTime: Date;
  endTime: Date;
  distance: number;
  movingTime: number;
  totalTime: number;
  elevationGain: number;
  trainingLoad: number;
  avgPaceMinPerKm: number;
  bestPaceMinPerKm: number;
  weekKey: string;
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  maxSpeedMps: 20,
  minPauseSeconds: 10,
  maxGapSeconds: 300,
  elevationSmoothingWindow: 5,
  minElevationGainThreshold: 3,
};

export const STANDARD_SPLITS = [1000, 5000, 10000, 21097.5, 42195];
