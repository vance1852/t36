import { describe, it, expect } from "vitest";
import {
  cleanTrack,
  annotatePointsWithStats,
  interpolateMissingPoints,
} from "../src/cleaner.js";
import { GpxTrack, GpxPoint, DEFAULT_CLEAN_OPTIONS } from "../src/types.js";

function createPoint(
  lat: number,
  lon: number,
  time: Date,
  ele?: number,
): GpxPoint {
  return { lat, lon, time, ele };
}

function createTrack(points: GpxPoint[]): GpxTrack {
  return {
    name: "test",
    segments: [{ points }],
  };
}

describe("cleaner", () => {
  describe("mergeDuplicateTimestamps", () => {
    it("should merge points with same timestamp", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points = [
        createPoint(31.23, 121.47, baseTime, 10),
        createPoint(31.24, 121.48, baseTime, 20),
      ];
      const track = createTrack(points);
      const result = cleanTrack(track);

      const totalPoints = result.segments.reduce(
        (sum, s) => sum + s.points.length,
        0,
      );
      expect(totalPoints).toBe(1);
      expect(result.stats.duplicateTimestampsMerged).toBe(1);
      expect(result.segments[0].points[0].lat).toBeCloseTo(31.235, 3);
      expect(result.segments[0].points[0].ele).toBeCloseTo(15, 1);
    });
  });

  describe("removeDriftPoints", () => {
    it("should remove obvious drift points", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points = [
        createPoint(31.23, 121.47, new Date(baseTime.getTime() + 0 * 1000)),
        createPoint(
          31.2301,
          121.4701,
          new Date(baseTime.getTime() + 10 * 1000),
        ),
        createPoint(31.5, 121.8, new Date(baseTime.getTime() + 11 * 1000)),
        createPoint(
          31.2302,
          121.4702,
          new Date(baseTime.getTime() + 12 * 1000),
        ),
        createPoint(
          31.2303,
          121.4703,
          new Date(baseTime.getTime() + 20 * 1000),
        ),
      ];
      const track = createTrack(points);
      const result = cleanTrack(track, { maxSpeedMps: 20 });

      expect(result.stats.driftPointsRemoved).toBeGreaterThan(0);
    });

    it("should keep normal points", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points: GpxPoint[] = [];
      for (let i = 0; i < 10; i++) {
        points.push(
          createPoint(
            31.23 + i * 0.0001,
            121.47 + i * 0.0001,
            new Date(baseTime.getTime() + i * 10 * 1000),
          ),
        );
      }
      const track = createTrack(points);
      const result = cleanTrack(track, { maxSpeedMps: 20 });

      const totalPoints = result.segments.reduce(
        (sum, s) => sum + s.points.length,
        0,
      );
      expect(result.stats.driftPointsRemoved).toBe(0);
      expect(totalPoints).toBe(10);
    });
  });

  describe("splitIntoSegments", () => {
    it("should split into segments for large time gaps", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points = [
        createPoint(31.23, 121.47, new Date(baseTime.getTime() + 0)),
        createPoint(31.24, 121.48, new Date(baseTime.getTime() + 1000)),
        createPoint(31.25, 121.49, new Date(baseTime.getTime() + 1000 * 1000)),
        createPoint(31.26, 121.5, new Date(baseTime.getTime() + 1001 * 1000)),
      ];
      const track = createTrack(points);
      const result = cleanTrack(track, { maxGapSeconds: 600 });

      expect(result.segments.length).toBe(2);
      expect(result.stats.gapSegments).toBe(1);
    });

    it("should keep single segment for normal gaps", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points = [
        createPoint(31.23, 121.47, new Date(baseTime.getTime() + 0)),
        createPoint(31.24, 121.48, new Date(baseTime.getTime() + 60 * 1000)),
        createPoint(31.25, 121.49, new Date(baseTime.getTime() + 120 * 1000)),
      ];
      const track = createTrack(points);
      const result = cleanTrack(track, { maxGapSeconds: 300 });

      expect(result.segments.length).toBe(1);
    });
  });

  describe("annotatePointsWithStats", () => {
    it("should annotate pause points", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points = [
        createPoint(31.23, 121.47, new Date(baseTime.getTime() + 0)),
        createPoint(31.23, 121.47, new Date(baseTime.getTime() + 30 * 1000)),
        createPoint(31.24, 121.48, new Date(baseTime.getTime() + 60 * 1000)),
      ];
      const annotated = annotatePointsWithStats(points, 10);

      expect(annotated.length).toBe(3);
      expect(annotated[1].isPause).toBe(true);
      expect(annotated[2].isPause).toBe(false);
    });

    it("should calculate distance and time from previous", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points = [
        createPoint(31.23, 121.47, new Date(baseTime.getTime() + 0)),
        createPoint(31.24, 121.48, new Date(baseTime.getTime() + 60 * 1000)),
      ];
      const annotated = annotatePointsWithStats(points, 10);

      expect(annotated[1].distanceFromPrev).toBeGreaterThan(0);
      expect(annotated[1].timeFromPrev).toBe(60);
      expect(annotated[1].speedMps).toBeGreaterThan(0);
    });
  });

  describe("interpolateMissingPoints", () => {
    it("should interpolate points for small gaps", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points = [
        createPoint(31.23, 121.47, new Date(baseTime.getTime() + 0), 10),
        createPoint(31.25, 121.49, new Date(baseTime.getTime() + 5 * 1000), 20),
      ];
      const result = interpolateMissingPoints(points, 60);

      expect(result.points.length).toBeGreaterThan(2);
      expect(result.interpolatedCount).toBeGreaterThan(0);
    });

    it("should not interpolate for gaps larger than max", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points = [
        createPoint(31.23, 121.47, new Date(baseTime.getTime() + 0)),
        createPoint(31.25, 121.49, new Date(baseTime.getTime() + 1000 * 1000)),
      ];
      const result = interpolateMissingPoints(points, 60);

      expect(result.points.length).toBe(2);
      expect(result.interpolatedCount).toBe(0);
    });

    it("should interpolate elevation linearly", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points = [
        createPoint(0, 0, new Date(baseTime.getTime() + 0), 0),
        createPoint(0, 0, new Date(baseTime.getTime() + 2 * 1000), 100),
      ];
      const result = interpolateMissingPoints(points, 60);

      const midPoint = result.points[1];
      expect(midPoint.ele).toBeCloseTo(50, 0);
    });
  });
});
