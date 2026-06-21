import { describe, it, expect } from "vitest";
import {
  analyzeTrack,
  paceFromSpeed,
  formatPace,
  formatDuration,
  calculateTrainingLoad,
} from "../src/analyzer.js";
import { GpxTrack, GpxPoint, STANDARD_SPLITS } from "../src/types.js";

function createPoint(
  lat: number,
  lon: number,
  time: Date,
  ele?: number,
): GpxPoint {
  return { lat, lon, time, ele };
}

function createTrack(points: GpxPoint[], type = "running"): GpxTrack {
  return {
    name: "test",
    type,
    segments: [{ points }],
  };
}

describe("analyzer", () => {
  describe("paceFromSpeed", () => {
    it("should convert speed to pace", () => {
      const pace = paceFromSpeed(1000 / 360);
      expect(pace).toBeCloseTo(6, 1);
    });

    it("should return infinity for zero speed", () => {
      expect(paceFromSpeed(0)).toBe(Infinity);
    });
  });

  describe("formatPace", () => {
    it("should format pace correctly", () => {
      expect(formatPace(5.5)).toBe("5'30\"");
      expect(formatPace(6.0)).toBe("6'00\"");
    });

    it("should handle zero pace", () => {
      expect(formatPace(0)).toBe("--:--");
    });
  });

  describe("formatDuration", () => {
    it("should format duration with hours", () => {
      expect(formatDuration(3661)).toBe("1:01:01");
    });

    it("should format duration without hours", () => {
      expect(formatDuration(61)).toBe("1:01");
    });
  });

  describe("calculateTrainingLoad", () => {
    it("should calculate training load", () => {
      const load = calculateTrainingLoad(10000, 100, 3600);
      expect(load).toBeGreaterThan(0);
    });
  });

  describe("analyzeTrack", () => {
    it("should analyze basic track metrics", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points: GpxPoint[] = [];

      for (let i = 0; i < 30; i++) {
        points.push(
          createPoint(
            31.23 + i * 0.0005,
            121.47 + i * 0.0005,
            new Date(baseTime.getTime() + i * 60 * 1000),
            10 + i * 0.5,
          ),
        );
      }

      const track = createTrack(points);
      const analysis = analyzeTrack(track);

      expect(analysis.totalDistance).toBeGreaterThan(0);
      expect(analysis.movingTime).toBeGreaterThan(0);
      expect(analysis.avgSpeedMps).toBeGreaterThan(0);
      expect(analysis.totalElevationGain).toBeGreaterThanOrEqual(0);
    });

    it("should find best splits for standard distances", () => {
      const baseTime = new Date("2025-01-01T00:00:00Z");
      const points: GpxPoint[] = [];

      const speedMps = 4;
      let lat = 31.23;
      let time = baseTime.getTime();

      for (let i = 0; i < 100; i++) {
        points.push({
          lat,
          lon: 121.47,
          time: new Date(time),
          ele: 10,
        });
        lat += 0.0001;
        time += 10 * 1000;
      }

      const track = createTrack(points);
      const analysis = analyzeTrack(track);

      expect(analysis.bestSplits).toBeDefined();
      expect(Object.keys(analysis.bestSplits).length).toBeGreaterThan(0);
    });

    it("should detect activity type from type field", () => {
      const points = [createPoint(0, 0, new Date())];
      const track = createTrack(points, "running");
      const analysis = analyzeTrack(track);
      expect(analysis.activityType).toBe("running");
    });

    it("should handle empty track", () => {
      const track: GpxTrack = {
        name: "empty",
        segments: [{ points: [] }],
      };
      const analysis = analyzeTrack(track);
      expect(analysis.totalDistance).toBe(0);
      expect(analysis.movingTime).toBe(0);
    });
  });
});
