import {
  GpxData,
  GpxTrack,
  TrackAnalysis,
  ActivityRecord,
  TrainingSummary,
  BestSplit,
} from "./types.js";
import { writeGpx } from "./gpx.js";
import { formatPace, formatDuration } from "./analyzer.js";

function safeNum(n: number, fallback = 0): number {
  return isFinite(n) ? n : fallback;
}

function safeFixed(n: number, digits = 2): string {
  return safeNum(n, 0).toFixed(digits);
}

function safeDate(d: Date, fallback = ""): string {
  if (!d || isNaN(d.getTime())) return fallback;
  return d.toISOString();
}

export function exportCleanedGpx(
  originalData: GpxData,
  cleanedTracks: GpxTrack[],
): string {
  const cleanedData: GpxData = {
    ...originalData,
    tracks: cleanedTracks,
  };
  return writeGpx(cleanedData);
}

export function exportCsvSummary(activities: ActivityRecord[]): string {
  const headers = [
    "文件名",
    "活动名称",
    "类型",
    "开始时间",
    "结束时间",
    "距离(km)",
    "移动时间",
    "总时间",
    "爬升(m)",
    "平均配速",
    "最快配速",
    "训练负荷",
    "周",
  ];

  const rows = activities.map((act) => [
    act.fileName,
    act.name || "",
    activityTypeLabel(act.type),
    safeDate(act.startTime),
    safeDate(act.endTime),
    safeFixed(act.distance / 1000, 2),
    formatDuration(safeNum(act.movingTime, 0)),
    formatDuration(safeNum(act.totalTime, 0)),
    safeFixed(act.elevationGain, 1),
    formatPace(safeNum(act.avgPaceMinPerKm, 0)),
    formatPace(safeNum(act.bestPaceMinPerKm, 0)),
    safeFixed(act.trainingLoad, 1),
    act.weekKey,
  ]);

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

function activityTypeLabel(type: string): string {
  switch (type) {
    case "running":
      return "跑步";
    case "cycling":
      return "骑行";
    default:
      return "未知";
  }
}

export function exportMarkdownReport(
  activities: ActivityRecord[],
  summary: TrainingSummary,
): string {
  const lines: string[] = [];

  lines.push("# 训练汇总报告");
  lines.push("");
  lines.push(`生成时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push("");

  lines.push("## 总览");
  lines.push("");
  lines.push(`- 总活动数: ${summary.totalActivities}`);
  lines.push(`- 总距离: ${safeFixed(summary.totalDistance / 1000, 2)} km`);
  lines.push(`- 总时长: ${formatDuration(safeNum(summary.totalDuration, 0))}`);
  lines.push(`- 总爬升: ${safeFixed(summary.totalElevationGain, 1)} m`);
  lines.push(
    `- 平均距离/次: ${safeFixed(summary.avgDistancePerActivity / 1000, 2)} km`,
  );
  lines.push(
    `- 平均时长/次: ${formatDuration(safeNum(summary.avgDurationPerActivity, 0))}`,
  );
  lines.push(`- 整体单调性: ${safeFixed(summary.overallMonotony, 2)}`);
  lines.push(`- 周增幅风险: ${summary.weeklyIncreaseRisk}`);
  lines.push("");

  lines.push("## 周统计");
  lines.push("");

  if (summary.weeklyStats.length > 0) {
    lines.push(
      "| 周 | 距离(km) | 时长 | 爬升(m) | 活动数 | 训练负荷 | 单调性 |",
    );
    lines.push("|---|---------|------|---------|--------|----------|--------|");

    for (const week of summary.weeklyStats) {
      lines.push(
        `| ${week.weekStart} ~ ${week.weekEnd} | ${safeFixed(week.distance / 1000, 2)} | ${formatDuration(safeNum(week.duration, 0))} | ${safeFixed(week.elevationGain, 1)} | ${week.activityCount} | ${safeFixed(week.trainingLoad, 1)} | ${safeFixed(week.monotony, 2)} |`,
      );
    }
  } else {
    lines.push("暂无周统计数据");
  }
  lines.push("");

  lines.push("## 活动详情");
  lines.push("");

  if (activities.length > 0) {
    lines.push(
      "| # | 活动 | 类型 | 日期 | 距离(km) | 移动时间 | 爬升(m) | 平均配速 | 最快配速 | 训练负荷 |",
    );
    lines.push(
      "|---|------|------|------|---------|----------|---------|----------|----------|----------|",
    );

    activities.forEach((act, idx) => {
      const dateStr =
        act.startTime && !isNaN(act.startTime.getTime())
          ? act.startTime.toLocaleDateString("zh-CN")
          : "";
      lines.push(
        `| ${idx + 1} | ${act.name || act.fileName} | ${activityTypeLabel(act.type)} | ${dateStr} | ${safeFixed(act.distance / 1000, 2)} | ${formatDuration(safeNum(act.movingTime, 0))} | ${safeFixed(act.elevationGain, 1)} | ${formatPace(safeNum(act.avgPaceMinPerKm, 0))} | ${formatPace(safeNum(act.bestPaceMinPerKm, 0))} | ${safeFixed(act.trainingLoad, 1)} |`,
      );
    });
  } else {
    lines.push("暂无活动数据");
  }
  lines.push("");

  lines.push("### 训练负荷说明");
  lines.push("");
  lines.push(
    "- **训练负荷**: 综合距离和爬升的指标，计算公式 = 距离(km) + 爬升(km) × 10",
  );
  lines.push(
    "- **单调性**: 衡量一周内训练量分布的均匀程度，值越高表示越单调，建议 < 1.5",
  );
  lines.push(
    "- **周增幅风险**: 基于最近几周负荷增长评估，>20% 为高风险，>10% 为中等风险",
  );
  lines.push("");

  return lines.join("\n");
}

export function exportSingleActivityReport(
  fileName: string,
  analysis: TrackAnalysis,
  cleanStats?: any,
): string {
  const lines: string[] = [];

  lines.push(`# ${fileName} - 分析报告`);
  lines.push("");
  lines.push(`生成时间: ${new Date().toLocaleString("zh-CN")}`);
  lines.push("");

  lines.push("## 基本信息");
  lines.push("");
  lines.push(`- 活动类型: ${activityTypeLabel(analysis.activityType)}`);
  if (analysis.startPoint?.time) {
    lines.push(
      `- 开始时间: ${analysis.startPoint.time.toLocaleString("zh-CN")}`,
    );
  }
  if (analysis.endPoint?.time) {
    lines.push(`- 结束时间: ${analysis.endPoint.time.toLocaleString("zh-CN")}`);
  }
  lines.push("");

  lines.push("## 距离与配速");
  lines.push("");
  lines.push(`- 总距离: ${safeFixed(analysis.totalDistance / 1000, 2)} km`);
  lines.push(`- 移动距离: ${safeFixed(analysis.movingDistance / 1000, 2)} km`);
  lines.push(`- 总时间: ${formatDuration(safeNum(analysis.totalTime, 0))}`);
  lines.push(`- 移动时间: ${formatDuration(safeNum(analysis.movingTime, 0))}`);
  lines.push(`- 暂停时间: ${formatDuration(safeNum(analysis.pauseTime, 0))}`);
  lines.push(
    `- 平均配速: ${formatPace(safeNum(analysis.avgPaceMinPerKm, 0))} /km`,
  );
  lines.push(
    `- 最快配速: ${formatPace(safeNum(analysis.bestPaceMinPerKm, 0))} /km`,
  );
  lines.push("");

  lines.push("## 海拔");
  lines.push("");
  lines.push(`- 总爬升: ${safeFixed(analysis.totalElevationGain, 1)} m`);
  lines.push(`- 总下降: ${safeFixed(analysis.totalElevationLoss, 1)} m`);
  lines.push(`- 最高海拔: ${safeFixed(analysis.maxElevation, 1)} m`);
  lines.push(`- 最低海拔: ${safeFixed(analysis.minElevation, 1)} m`);
  lines.push("");

  lines.push("## 最快分段");
  lines.push("");

  const validSplits = Object.entries(analysis.bestSplits).filter(
    ([, split]) =>
      split.duration > 0 &&
      isFinite(split.paceMinPerKm) &&
      split.paceMinPerKm > 0,
  );

  if (validSplits.length > 0) {
    lines.push("| 分段 | 距离 | 用时 | 配速 |");
    lines.push("|------|------|------|------|");

    for (const [name, split] of validSplits) {
      lines.push(
        `| ${name} | ${(split.distance / 1000).toFixed(2)} km | ${formatDuration(split.duration)} | ${formatPace(split.paceMinPerKm)} /km |`,
      );
    }
  } else {
    lines.push("距离不足，无法计算标准分段");
  }
  lines.push("");

  if (analysis.segments.length > 1) {
    lines.push("## 分段详情");
    lines.push("");
    lines.push(`共 ${analysis.segments.length} 个分段`);
    lines.push("");
    lines.push("| 分段 | 距离(km) | 移动时间 | 暂停时间 | 爬升(m) |");
    lines.push("|------|---------|----------|----------|---------|");

    for (const seg of analysis.segments) {
      lines.push(
        `| ${seg.id + 1} | ${safeFixed(seg.distance / 1000, 3)} | ${formatDuration(safeNum(seg.movingTime, 0))} | ${formatDuration(safeNum(seg.pauseTime, 0))} | ${safeFixed(seg.elevationGain, 1)} |`,
      );
    }
    lines.push("");
  }

  if (cleanStats) {
    lines.push("## 清洗统计");
    lines.push("");
    lines.push(`- 原始点数: ${cleanStats.originalPointCount}`);
    lines.push(`- 清洗后点数: ${cleanStats.cleanedPointCount}`);
    lines.push(`- 移除漂移点: ${cleanStats.driftPointsRemoved}`);
    lines.push(`- 合并重复时间戳: ${cleanStats.duplicateTimestampsMerged}`);
    lines.push(`- 暂停段数: ${cleanStats.pauseSegments}`);
    lines.push(`- 断段数: ${cleanStats.gapSegments}`);
    lines.push(`- 插值点数: ${cleanStats.interpolatedPoints}`);
    lines.push("");
  }

  return lines.join("\n");
}
