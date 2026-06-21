import { describe, it, expect } from "vitest";
import {
  getWeekKey,
  getWeekRange,
  calculateWeeklyStats,
  calculateOverallMonotony,
  calculateWeeklyIncreaseRisk,
  generateTrainingSummary,
  buildActivityRecord,
} from "../src/stats.js";
import { ActivityRecord } from "../src/types.js";

describe("stats", () => {
  describe("getWeekKey", () => {
    it("should return Monday as week start", () => {
      const date = new Date("2025-01-15T12:00:00Z");
      const key = getWeekKey(date);
      const { start } = getWeekRange(key);
      expect(start.getUTCDay()).toBe(1);
    });

    it("should handle Sunday correctly (week starts Monday)", () => {
      const sunday = new Date("2025-01-12T12:00:00Z");
      const key = getWeekKey(sunday);
      const { start } = getWeekRange(key);
      expect(start.getUTCDate()).toBe(6);
    });

    it("跨午夜活动应以开始时间归属到正确的周", () => {
      const sundayNight = new Date("2025-01-19T23:30:00Z");
      const mondayMorning = new Date("2025-01-20T00:30:00Z");

      const sundayKey = getWeekKey(sundayNight);
      const mondayKey = getWeekKey(mondayMorning);

      expect(sundayKey).not.toBe(mondayKey);

      const sundayRange = getWeekRange(sundayKey);
      expect(sundayNight.getTime()).toBeGreaterThanOrEqual(
        sundayRange.start.getTime(),
      );
      expect(sundayNight.getTime()).toBeLessThanOrEqual(
        sundayRange.end.getTime(),
      );
    });
  });

  describe("getWeekRange", () => {
    it("should return 7-day range starting Monday", () => {
      const { start, end } = getWeekRange("2025-01-13");
      expect(start.getUTCDay()).toBe(1);
      expect(end.getUTCDay()).toBe(0);
      expect(end.getUTCDate() - start.getUTCDate()).toBe(6);
    });
  });

  describe("calculateWeeklyStats", () => {
    it("should calculate weekly stats from activities", () => {
      const activities: ActivityRecord[] = [
        {
          fileName: "run1.gpx",
          name: "Run 1",
          type: "running",
          startTime: new Date("2025-01-13T08:00:00Z"),
          endTime: new Date("2025-01-13T09:00:00Z"),
          distance: 10000,
          movingTime: 3600,
          totalTime: 3600,
          elevationGain: 50,
          trainingLoad: 15,
          avgPaceMinPerKm: 6,
          bestPaceMinPerKm: 5,
          weekKey: getWeekKey(new Date("2025-01-13T08:00:00Z")),
        },
        {
          fileName: "run2.gpx",
          name: "Run 2",
          type: "running",
          startTime: new Date("2025-01-15T08:00:00Z"),
          endTime: new Date("2025-01-15T08:30:00Z"),
          distance: 5000,
          movingTime: 1800,
          totalTime: 1800,
          elevationGain: 30,
          trainingLoad: 8,
          avgPaceMinPerKm: 6,
          bestPaceMinPerKm: 5,
          weekKey: getWeekKey(new Date("2025-01-15T08:00:00Z")),
        },
      ];

      const stats = calculateWeeklyStats(activities);

      expect(stats.length).toBe(1);
      expect(stats[0].activityCount).toBe(2);
      expect(stats[0].distance).toBeCloseTo(15000, 0);
      expect(stats[0].trainingLoad).toBe(23);
      expect(stats[0].monotony).toBeGreaterThanOrEqual(0);
    });

    it("should group activities by week", () => {
      const activities: ActivityRecord[] = [
        {
          fileName: "w1.gpx",
          type: "running",
          startTime: new Date("2025-01-13T08:00:00Z"),
          endTime: new Date("2025-01-13T09:00:00Z"),
          distance: 10000,
          movingTime: 3600,
          totalTime: 3600,
          elevationGain: 50,
          trainingLoad: 10,
          avgPaceMinPerKm: 6,
          bestPaceMinPerKm: 5,
          weekKey: getWeekKey(new Date("2025-01-13T08:00:00Z")),
        },
        {
          fileName: "w2.gpx",
          type: "running",
          startTime: new Date("2025-01-20T08:00:00Z"),
          endTime: new Date("2025-01-20T09:00:00Z"),
          distance: 10000,
          movingTime: 3600,
          totalTime: 3600,
          elevationGain: 50,
          trainingLoad: 10,
          avgPaceMinPerKm: 6,
          bestPaceMinPerKm: 5,
          weekKey: getWeekKey(new Date("2025-01-20T08:00:00Z")),
        },
      ];

      const stats = calculateWeeklyStats(activities);
      expect(stats.length).toBe(2);
    });
  });

  describe("calculateWeeklyIncreaseRisk", () => {
    it("should return data不足 for less than 2 weeks", () => {
      const stats = calculateWeeklyStats([]);
      expect(calculateWeeklyIncreaseRisk(stats)).toBe("数据不足");
    });

    it("should return low risk for stable load", () => {
      const activities: ActivityRecord[] = [];
      const weekStarts = [
        "2025-01-06",
        "2025-01-13",
        "2025-01-20",
        "2025-01-27",
      ];

      for (let w = 0; w < 4; w++) {
        const weekStart = new Date(weekStarts[w] + "T00:00:00Z");
        for (let d = 0; d < 3; d++) {
          const date = new Date(weekStart.getTime() + d * 2 * 86400 * 1000);
          activities.push({
            fileName: `act-${w}-${d}.gpx`,
            type: "running",
            startTime: date,
            endTime: new Date(date.getTime() + 3600 * 1000),
            distance: 10000,
            movingTime: 3600,
            totalTime: 3600,
            elevationGain: 0,
            trainingLoad: 10,
            avgPaceMinPerKm: 6,
            bestPaceMinPerKm: 5,
            weekKey: getWeekKey(date),
          });
        }
      }
      const stats = calculateWeeklyStats(activities);
      const risk = calculateWeeklyIncreaseRisk(stats);
      expect(risk).toBe("低风险");
    });
  });

  describe("generateTrainingSummary", () => {
    it("should generate complete summary", () => {
      const activities: ActivityRecord[] = [
        {
          fileName: "run1.gpx",
          name: "Morning Run",
          type: "running",
          startTime: new Date("2025-01-13T08:00:00Z"),
          endTime: new Date("2025-01-13T09:00:00Z"),
          distance: 10000,
          movingTime: 3600,
          totalTime: 3600,
          elevationGain: 50,
          trainingLoad: 10,
          avgPaceMinPerKm: 6,
          bestPaceMinPerKm: 5,
          weekKey: "2025-01-13",
        },
      ];

      const summary = generateTrainingSummary(activities);

      expect(summary.totalActivities).toBe(1);
      expect(summary.totalDistance).toBe(10000);
      expect(summary.weeklyStats.length).toBe(1);
      expect(summary.weeklyIncreaseRisk).toBeDefined();
    });
  });
});
