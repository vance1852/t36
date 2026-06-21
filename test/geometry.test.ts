import { describe, it, expect } from "vitest";
import {
  haversineDistance,
  pointDistance,
  smoothElevation,
  calculateElevationGain,
  cumulativeDistances,
} from "../src/geometry.js";
import { GpxPoint } from "../src/types.js";

describe("geometry", () => {
  describe("haversineDistance", () => {
    it("should calculate distance between same point as zero", () => {
      const dist = haversineDistance(31.23, 121.47, 31.23, 121.47);
      expect(dist).toBeCloseTo(0, 2);
    });

    it("should calculate distance between two points", () => {
      const dist = haversineDistance(31.2304, 121.4737, 31.2309, 121.4742);
      expect(dist).toBeGreaterThan(50);
      expect(dist).toBeLessThan(100);
    });

    it("should calculate 1 degree latitude approximately 111km", () => {
      const dist = haversineDistance(0, 0, 1, 0);
      expect(dist).toBeGreaterThan(110000);
      expect(dist).toBeLessThan(112000);
    });
  });

  describe("pointDistance", () => {
    it("should calculate distance between two GpxPoints", () => {
      const p1: GpxPoint = { lat: 31.2304, lon: 121.4737 };
      const p2: GpxPoint = { lat: 31.2309, lon: 121.4742 };
      const dist = pointDistance(p1, p2);
      expect(dist).toBeGreaterThan(0);
    });
  });

  describe("smoothElevation", () => {
    it("should return same points for empty array", () => {
      const result = smoothElevation([], 5);
      expect(result).toEqual([]);
    });

    it("should smooth elevation spikes", () => {
      const points: GpxPoint[] = [
        { lat: 0, lon: 0, ele: 10 },
        { lat: 0, lon: 0, ele: 10 },
        { lat: 0, lon: 0, ele: 50 },
        { lat: 0, lon: 0, ele: 10 },
        { lat: 0, lon: 0, ele: 10 },
      ];
      const result = smoothElevation(points, 3);
      expect(result[2].ele).toBeLessThan(50);
      expect(result[2].ele).toBeGreaterThan(10);
    });

    it("should preserve points without elevation", () => {
      const points: GpxPoint[] = [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 0 },
      ];
      const result = smoothElevation(points, 3);
      expect(result.length).toBe(2);
      expect(result[0].ele).toBeUndefined();
    });
  });

  describe("calculateElevationGain", () => {
    it("should return zero for empty array", () => {
      const result = calculateElevationGain([], 3);
      expect(result.gain).toBe(0);
      expect(result.loss).toBe(0);
    });

    it("should calculate elevation gain with threshold", () => {
      const points: GpxPoint[] = [
        { lat: 0, lon: 0, ele: 10 },
        { lat: 0, lon: 0, ele: 11 },
        { lat: 0, lon: 0, ele: 20 },
        { lat: 0, lon: 0, ele: 15 },
        { lat: 0, lon: 0, ele: 5 },
      ];
      const result = calculateElevationGain(points, 3);
      expect(result.gain).toBeGreaterThan(0);
      expect(result.loss).toBeGreaterThan(0);
      expect(result.max).toBe(20);
      expect(result.min).toBe(5);
    });

    it("should ignore small changes below threshold", () => {
      const points: GpxPoint[] = [
        { lat: 0, lon: 0, ele: 10 },
        { lat: 0, lon: 0, ele: 11 },
        { lat: 0, lon: 0, ele: 10 },
        { lat: 0, lon: 0, ele: 11 },
      ];
      const result = calculateElevationGain(points, 5);
      expect(result.gain).toBe(0);
      expect(result.loss).toBe(0);
    });
  });

  describe("cumulativeDistances", () => {
    it("should return [0] for single point", () => {
      const points: GpxPoint[] = [{ lat: 0, lon: 0 }];
      const result = cumulativeDistances(points);
      expect(result).toEqual([0]);
    });

    it("should calculate cumulative distances", () => {
      const points: GpxPoint[] = [
        { lat: 31.23, lon: 121.47 },
        { lat: 31.231, lon: 121.471 },
        { lat: 31.232, lon: 121.472 },
      ];
      const result = cumulativeDistances(points);
      expect(result.length).toBe(3);
      expect(result[0]).toBe(0);
      expect(result[1]).toBeGreaterThan(0);
      expect(result[2]).toBeGreaterThan(result[1]);
    });
  });
});
