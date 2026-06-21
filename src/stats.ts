import { ActivityRecord, WeeklyStats, TrainingSummary } from "./types.js";
import { calculateTrainingLoad } from "./analyzer.js";

export function getWeekKey(date: Date): string {
  if (isNaN(date.getTime())) {
    return "unknown";
  }
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setUTCDate(diff);
  const year = monday.getUTCFullYear();
  const month = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const dayNum = String(monday.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${dayNum}`;
}

export function getWeekRange(weekKey: string): { start: Date; end: Date } {
  if (weekKey === "unknown") {
    const now = new Date();
    return { start: now, end: now };
  }
  const [year, month, day] = weekKey.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

export function calculateWeeklyStats(
  activities: ActivityRecord[],
): WeeklyStats[] {
  const weekMap = new Map<string, ActivityRecord[]>();

  for (const activity of activities) {
    const key = activity.weekKey;
    if (!weekMap.has(key)) {
      weekMap.set(key, []);
    }
    weekMap.get(key)!.push(activity);
  }

  const weeklyStats: WeeklyStats[] = [];

  const sortedKeys = Array.from(weekMap.keys()).sort();

  for (const key of sortedKeys) {
    const weekActivities = weekMap.get(key)!;
    const { start, end } = getWeekRange(key);

    let distance = 0;
    let duration = 0;
    let elevationGain = 0;
    let totalLoad = 0;

    for (const act of weekActivities) {
      distance += act.distance;
      duration += act.movingTime;
      elevationGain += act.elevationGain;
      totalLoad += act.trainingLoad;
    }

    const dailyLoads: number[] = [];
    const dayLoads = new Map<number, number>();

    for (const act of weekActivities) {
      const dayOfWeek = new Date(act.startTime).getDay();
      const normalizedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      dayLoads.set(
        normalizedDay,
        (dayLoads.get(normalizedDay) || 0) + act.trainingLoad,
      );
    }

    for (let d = 0; d < 7; d++) {
      dailyLoads.push(dayLoads.get(d) || 0);
    }

    const monotony = calculateMonotony(dailyLoads, totalLoad);

    weeklyStats.push({
      weekStart: start.toISOString().split("T")[0],
      weekEnd: end.toISOString().split("T")[0],
      distance,
      duration,
      elevationGain,
      activityCount: weekActivities.length,
      trainingLoad: totalLoad,
      monotony,
    });
  }

  return weeklyStats;
}

function calculateMonotony(dailyLoads: number[], weeklyLoad: number): number {
  if (weeklyLoad === 0) return 0;

  const avgDailyLoad = weeklyLoad / 7;
  if (avgDailyLoad === 0) return 0;

  let sumSqDiff = 0;
  let activeDays = 0;

  for (const load of dailyLoads) {
    sumSqDiff += Math.pow(load - avgDailyLoad, 2);
    if (load > 0) activeDays++;
  }

  const variance = sumSqDiff / 7;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return activeDays > 0 ? 1 : 0;

  return avgDailyLoad / stdDev;
}

export function calculateWeeklyIncreaseRisk(
  weeklyStats: WeeklyStats[],
): string {
  if (weeklyStats.length < 2) return "数据不足";

  const recentWeeks = weeklyStats.slice(-4);
  if (recentWeeks.length < 2) return "数据不足";

  let maxIncrease = 0;
  let hasHighRisk = false;
  let hasMediumRisk = false;

  for (let i = 1; i < recentWeeks.length; i++) {
    const prevLoad = recentWeeks[i - 1].trainingLoad;
    const currLoad = recentWeeks[i].trainingLoad;

    if (prevLoad > 0) {
      const increase = (currLoad - prevLoad) / prevLoad;
      if (increase > maxIncrease) maxIncrease = increase;
      if (increase > 0.2) hasHighRisk = true;
      else if (increase > 0.1) hasMediumRisk = true;
    }
  }

  if (hasHighRisk) return "高风险";
  if (hasMediumRisk) return "中等风险";
  return "低风险";
}

export function calculateOverallMonotony(weeklyStats: WeeklyStats[]): number {
  if (weeklyStats.length === 0) return 0;

  const totalMonotony = weeklyStats.reduce((sum, w) => sum + w.monotony, 0);
  return totalMonotony / weeklyStats.length;
}

export function generateTrainingSummary(
  activities: ActivityRecord[],
): TrainingSummary {
  const weeklyStats = calculateWeeklyStats(activities);
  const weeklyIncreaseRisk = calculateWeeklyIncreaseRisk(weeklyStats);
  const overallMonotony = calculateOverallMonotony(weeklyStats);

  const totalDistance = activities.reduce((sum, a) => sum + a.distance, 0);
  const totalDuration = activities.reduce((sum, a) => sum + a.movingTime, 0);
  const totalElevationGain = activities.reduce(
    (sum, a) => sum + a.elevationGain,
    0,
  );

  return {
    totalActivities: activities.length,
    totalDistance,
    totalDuration,
    totalElevationGain,
    avgDistancePerActivity:
      activities.length > 0 ? totalDistance / activities.length : 0,
    avgDurationPerActivity:
      activities.length > 0 ? totalDuration / activities.length : 0,
    weeklyStats,
    overallMonotony,
    weeklyIncreaseRisk,
  };
}

export function buildActivityRecord(
  fileName: string,
  analysis: any,
  startTime: Date,
): ActivityRecord {
  const weekKey = getWeekKey(startTime);

  const safeDistance =
    isFinite(analysis.totalDistance) && analysis.totalDistance > 0
      ? analysis.totalDistance
      : 0;
  const safeMovingTime =
    isFinite(analysis.movingTime) && analysis.movingTime >= 0
      ? analysis.movingTime
      : 0;
  const safeTotalTime =
    isFinite(analysis.totalTime) && analysis.totalTime >= 0
      ? analysis.totalTime
      : 0;
  const safeElevationGain =
    isFinite(analysis.totalElevationGain) && analysis.totalElevationGain >= 0
      ? analysis.totalElevationGain
      : 0;
  const safeAvgPace =
    isFinite(analysis.avgPaceMinPerKm) && analysis.avgPaceMinPerKm > 0
      ? analysis.avgPaceMinPerKm
      : 0;
  const safeBestPace =
    isFinite(analysis.bestPaceMinPerKm) && analysis.bestPaceMinPerKm > 0
      ? analysis.bestPaceMinPerKm
      : 0;
  const safeEndTime =
    analysis.endPoint?.time && !isNaN(analysis.endPoint.time.getTime())
      ? analysis.endPoint.time
      : startTime;

  return {
    fileName,
    name: analysis.name,
    type: analysis.activityType,
    startTime,
    endTime: safeEndTime,
    distance: safeDistance,
    movingTime: safeMovingTime,
    totalTime: safeTotalTime,
    elevationGain: safeElevationGain,
    trainingLoad: calculateTrainingLoad(
      safeDistance,
      safeElevationGain,
      safeMovingTime,
    ),
    avgPaceMinPerKm: safeAvgPace,
    bestPaceMinPerKm: safeBestPace,
    weekKey,
  };
}
