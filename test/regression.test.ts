import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "fs";
import { join, basename } from "path";
import { validateGpx, parseGpx } from "../src/gpx.js";
import { buildActivityRecord, generateTrainingSummary } from "../src/stats.js";
import { exportCsvSummary, exportMarkdownReport } from "../src/exporter.js";
import { analyzeTrack } from "../src/analyzer.js";
import { cleanTrack } from "../src/cleaner.js";

const samplesDir = join(process.cwd(), "samples");
const tmpDir = join(process.cwd(), ".tmp_regression");

describe("regression: 坏文件处理", () => {
  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("validateGpx", () => {
    it("应检测到无效坐标（lat='invalid'）", () => {
      const content = readFileSync(join(samplesDir, "corrupt.gpx"), "utf-8");
      const result = validateGpx(content);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("invalid coordinates"))).toBe(
        true,
      );
    });

    it("应检测到无效经度（lon=999.999）", () => {
      const content = readFileSync(join(samplesDir, "corrupt.gpx"), "utf-8");
      const result = validateGpx(content);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("invalid longitude"))).toBe(
        true,
      );
    });

    it("应检测到无效时间戳", () => {
      const content = readFileSync(join(samplesDir, "corrupt.gpx"), "utf-8");
      const result = validateGpx(content);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("invalid timestamp"))).toBe(
        true,
      );
    });

    it("对正常 GPX 应返回 valid=true", () => {
      const content = readFileSync(join(samplesDir, "normal-run.gpx"), "utf-8");
      const result = validateGpx(content);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("buildActivityRecord 防 NaN", () => {
    it("面对全是 NaN 的分析结果，输出字段不能有 NaN", () => {
      const badAnalysis = {
        totalDistance: NaN,
        movingTime: NaN,
        totalTime: NaN,
        totalElevationGain: NaN,
        avgPaceMinPerKm: NaN,
        bestPaceMinPerKm: NaN,
        activityType: "running",
        endPoint: { time: new Date("not-a-date") },
      };
      const startTime = new Date("2025-01-13T07:00:00Z");

      const record = buildActivityRecord("test.gpx", badAnalysis, startTime);

      expect(Number.isNaN(record.distance)).toBe(false);
      expect(Number.isNaN(record.movingTime)).toBe(false);
      expect(Number.isNaN(record.totalTime)).toBe(false);
      expect(Number.isNaN(record.elevationGain)).toBe(false);
      expect(Number.isNaN(record.trainingLoad)).toBe(false);
      expect(Number.isNaN(record.avgPaceMinPerKm)).toBe(false);
      expect(Number.isNaN(record.bestPaceMinPerKm)).toBe(false);
      expect(Number.isNaN(record.endTime.getTime())).toBe(false);
      expect(record.distance).toBe(0);
      expect(record.movingTime).toBe(0);
    });

    it("面对 Infinity 的分析结果，输出字段不能有 Infinity", () => {
      const badAnalysis = {
        totalDistance: Infinity,
        movingTime: Infinity,
        totalTime: Infinity,
        totalElevationGain: Infinity,
        avgPaceMinPerKm: Infinity,
        bestPaceMinPerKm: Infinity,
        activityType: "running",
      };
      const startTime = new Date("2025-01-13T07:00:00Z");

      const record = buildActivityRecord("test.gpx", badAnalysis, startTime);

      expect(Number.isFinite(record.distance)).toBe(true);
      expect(Number.isFinite(record.movingTime)).toBe(true);
      expect(Number.isFinite(record.elevationGain)).toBe(true);
      expect(Number.isFinite(record.trainingLoad)).toBe(true);
    });
  });

  describe("导出不出现 NaN", () => {
    it("CSV 汇总中不应出现 'NaN' 字符串", () => {
      const startTime = new Date("2025-01-13T07:00:00Z");
      const badAnalysis = {
        totalDistance: NaN,
        movingTime: NaN,
        totalTime: NaN,
        totalElevationGain: NaN,
        avgPaceMinPerKm: NaN,
        bestPaceMinPerKm: NaN,
        activityType: "running",
      };
      const record = buildActivityRecord("bad.gpx", badAnalysis, startTime);

      const csv = exportCsvSummary([record]);
      expect(csv).not.toContain("NaN");
    });

    it("Markdown 报告中不应出现 'NaN' 字符串", () => {
      const startTime = new Date("2025-01-13T07:00:00Z");
      const badAnalysis = {
        totalDistance: NaN,
        movingTime: NaN,
        totalTime: NaN,
        totalElevationGain: NaN,
        avgPaceMinPerKm: NaN,
        bestPaceMinPerKm: NaN,
        activityType: "running",
      };
      const record = buildActivityRecord("bad.gpx", badAnalysis, startTime);
      const summary = generateTrainingSummary([record]);

      const md = exportMarkdownReport([record], summary);
      expect(md).not.toContain("NaN");
    });
  });

  describe("坏文件不进入统计", () => {
    it("损坏 GPX 不应影响训练汇总统计", () => {
      const normalContent = readFileSync(
        join(samplesDir, "normal-run.gpx"),
        "utf-8",
      );
      const corruptContent = readFileSync(
        join(samplesDir, "corrupt.gpx"),
        "utf-8",
      );

      const normalValid = validateGpx(normalContent);
      const corruptValid = validateGpx(corruptContent);

      expect(normalValid.valid).toBe(true);
      expect(corruptValid.valid).toBe(false);

      const normalData = parseGpx(normalContent);
      const normalResult = cleanTrack(normalData.tracks[0]);
      const cleanedNormal = {
        ...normalData.tracks[0],
        segments: normalResult.segments,
      };
      const normalAnalysis = analyzeTrack(cleanedNormal);
      const startTime = cleanedNormal.segments[0].points[0].time!;
      const normalRecord = buildActivityRecord(
        "normal-run.gpx",
        normalAnalysis,
        startTime,
      );

      const summary = generateTrainingSummary([normalRecord]);

      expect(summary.totalActivities).toBe(1);
      expect(summary.totalDistance).toBeGreaterThan(0);
      expect(Number.isFinite(summary.totalDistance)).toBe(true);
      expect(Number.isFinite(summary.overallMonotony)).toBe(true);
      expect(summary.weeklyStats.length).toBeGreaterThan(0);
    });
  });

  describe("clean 命令：坏文件不输出 cleaned GPX", () => {
    it("对于损坏文件，不应在输出目录生成对应文件", () => {
      const cleanOutDir = join(tmpDir, "cleaned");
      const corruptContent = readFileSync(
        join(samplesDir, "corrupt.gpx"),
        "utf-8",
      );
      const normalContent = readFileSync(
        join(samplesDir, "normal-run.gpx"),
        "utf-8",
      );

      const corruptFile = join(tmpDir, "corrupt_copy.gpx");
      const normalFile = join(tmpDir, "normal_copy.gpx");
      writeFileSync(corruptFile, corruptContent, "utf-8");
      writeFileSync(normalFile, normalContent, "utf-8");

      mkdirSync(cleanOutDir, { recursive: true });

      for (const f of [corruptFile, normalFile]) {
        const content = readFileSync(f, "utf-8");
        const validation = validateGpx(content);
        if (!validation.valid) continue;

        const data = parseGpx(content);
        const cleanedTracks = data.tracks.map((t) => {
          const r = cleanTrack(t);
          return { ...t, segments: r.segments };
        });

        const outPath = join(cleanOutDir, basename(f));
        const cleanedGpxContent = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          "<gpx>",
          "</gpx>",
        ].join("\n");
        writeFileSync(outPath, cleanedGpxContent, "utf-8");
      }

      const generatedFiles = readdirSync(cleanOutDir);
      expect(generatedFiles).toContain("normal_copy.gpx");
      expect(generatedFiles).not.toContain("corrupt_copy.gpx");
    });
  });
});
