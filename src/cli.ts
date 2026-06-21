import { Command } from "commander";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
} from "fs";
import { join, extname, basename, dirname } from "path";
import { parseGpx, validateGpx, writeGpx } from "./gpx.js";
import { cleanTrack } from "./cleaner.js";
import { analyzeTrack, formatPace, formatDuration } from "./analyzer.js";
import { buildActivityRecord, generateTrainingSummary } from "./stats.js";
import {
  exportCsvSummary,
  exportMarkdownReport,
  exportCleanedGpx,
  exportSingleActivityReport,
} from "./exporter.js";
import {
  DEFAULT_CLEAN_OPTIONS,
  GpxData,
  GpxTrack,
  ActivityRecord,
} from "./types.js";

const program = new Command();

program
  .name("gpx")
  .description("GPX 轨迹清洗与训练负荷分析工具")
  .version("1.0.0");

function collectGpxFiles(input: string): string[] {
  const files: string[] = [];

  if (!existsSync(input)) {
    console.error(`错误: 路径不存在: ${input}`);
    process.exit(1);
  }

  const stats = statSync(input);

  if (stats.isFile()) {
    if (extname(input).toLowerCase() === ".gpx") {
      files.push(input);
    }
  } else if (stats.isDirectory()) {
    const entries = readdirSync(input);
    for (const entry of entries) {
      const fullPath = join(input, entry);
      const entryStats = statSync(fullPath);
      if (entryStats.isFile() && extname(entry).toLowerCase() === ".gpx") {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function loadGpxFile(filePath: string): GpxData | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    return parseGpx(content);
  } catch (e: any) {
    console.error(`  警告: 无法解析文件 ${basename(filePath)}: ${e.message}`);
    return null;
  }
}

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

program
  .command("validate")
  .description("校验 GPX 文件")
  .argument("<input>", "GPX 文件或目录")
  .action((input: string) => {
    const files = collectGpxFiles(input);

    if (files.length === 0) {
      console.log("未找到 GPX 文件");
      return;
    }

    console.log(`找到 ${files.length} 个 GPX 文件\n`);

    let validCount = 0;
    let invalidCount = 0;

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const result = validateGpx(content);

      if (result.valid) {
        console.log(`✅ ${basename(file)} - 有效`);
        validCount++;
      } else {
        console.log(`❌ ${basename(file)} - 无效`);
        for (const err of result.errors) {
          console.log(`   - ${err}`);
        }
        invalidCount++;
      }
    }

    console.log(`\n总计: ${validCount} 有效, ${invalidCount} 无效`);
  });

program
  .command("clean")
  .description("清洗 GPX 轨迹")
  .argument("<input>", "GPX 文件或目录")
  .option("-o, --output <dir>", "输出目录", "cleaned")
  .option(
    "--max-speed <mps>",
    "最大速度阈值 (m/s)",
    String(DEFAULT_CLEAN_OPTIONS.maxSpeedMps),
  )
  .option(
    "--min-pause <sec>",
    "最小暂停时间 (秒)",
    String(DEFAULT_CLEAN_OPTIONS.minPauseSeconds),
  )
  .option(
    "--max-gap <sec>",
    "最大时间间隙 (秒)",
    String(DEFAULT_CLEAN_OPTIONS.maxGapSeconds),
  )
  .option(
    "--elev-window <n>",
    "海拔平滑窗口大小",
    String(DEFAULT_CLEAN_OPTIONS.elevationSmoothingWindow),
  )
  .action((input: string, options: any) => {
    const files = collectGpxFiles(input);

    if (files.length === 0) {
      console.log("未找到 GPX 文件");
      return;
    }

    const cleanOptions = {
      maxSpeedMps: parseFloat(options.maxSpeed),
      minPauseSeconds: parseFloat(options.minPause),
      maxGapSeconds: parseFloat(options.maxGap),
      elevationSmoothingWindow: parseInt(options.elevWindow, 10),
      minElevationGainThreshold:
        DEFAULT_CLEAN_OPTIONS.minElevationGainThreshold,
    };

    console.log(`清洗 ${files.length} 个 GPX 文件...\n`);

    let successCount = 0;
    let skipCount = 0;

    for (const file of files) {
      const data = loadGpxFile(file);
      if (!data) {
        skipCount++;
        continue;
      }

      const cleanedTracks: GpxTrack[] = [];
      let totalDriftRemoved = 0;
      let totalDupMerged = 0;

      for (const track of data.tracks) {
        const result = cleanTrack(track, cleanOptions);
        cleanedTracks.push({
          ...track,
          segments: result.segments,
        });
        totalDriftRemoved += result.stats.driftPointsRemoved;
        totalDupMerged += result.stats.duplicateTimestampsMerged;
      }

      const outputPath = join(options.output, basename(file));
      ensureDir(outputPath);

      const cleanedGpx = exportCleanedGpx(data, cleanedTracks);
      writeFileSync(outputPath, cleanedGpx, "utf-8");

      console.log(`✅ ${basename(file)}`);
      console.log(
        `   移除漂移点: ${totalDriftRemoved}, 合并重复时间戳: ${totalDupMerged}`,
      );
      console.log(`   输出: ${outputPath}`);

      successCount++;
    }

    console.log(`\n完成: ${successCount} 成功, ${skipCount} 跳过`);
  });

program
  .command("analyze")
  .description("分析单个 GPX 轨迹")
  .argument("<input>", "GPX 文件")
  .option("-o, --output <file>", "输出 Markdown 报告路径")
  .option("--clean", "先清洗再分析", false)
  .action((input: string, options: any) => {
    if (!existsSync(input) || !statSync(input).isFile()) {
      console.error("错误: 请提供有效的 GPX 文件");
      process.exit(1);
    }

    const data = loadGpxFile(input);
    if (!data || data.tracks.length === 0) {
      console.error("错误: 无法解析 GPX 文件或没有轨迹数据");
      process.exit(1);
    }

    let tracks = data.tracks;
    let cleanStats: any = null;

    if (options.clean) {
      const cleanedTracks: GpxTrack[] = [];
      let totalDrift = 0;
      let totalDup = 0;
      let totalGap = 0;

      for (const track of data.tracks) {
        const result = cleanTrack(track);
        cleanedTracks.push({
          ...track,
          segments: result.segments,
        });
        totalDrift += result.stats.driftPointsRemoved;
        totalDup += result.stats.duplicateTimestampsMerged;
        totalGap += result.stats.gapSegments;
      }
      tracks = cleanedTracks;
      cleanStats = {
        driftPointsRemoved: totalDrift,
        duplicateTimestampsMerged: totalDup,
        gapSegments: totalGap,
      };
    }

    const mainTrack = tracks[0];
    const analysis = analyzeTrack(mainTrack);

    console.log(`\n=== ${basename(input)} ===\n`);
    console.log(`距离: ${(analysis.totalDistance / 1000).toFixed(2)} km`);
    console.log(`移动时间: ${formatDuration(analysis.movingTime)}`);
    console.log(`总时间: ${formatDuration(analysis.totalTime)}`);
    console.log(`暂停时间: ${formatDuration(analysis.pauseTime)}`);
    console.log(`平均配速: ${formatPace(analysis.avgPaceMinPerKm)} /km`);
    console.log(`最快配速: ${formatPace(analysis.bestPaceMinPerKm)} /km`);
    console.log(`爬升: ${analysis.totalElevationGain.toFixed(1)} m`);
    console.log(`下降: ${analysis.totalElevationLoss.toFixed(1)} m`);

    console.log(`\n最快分段:`);
    for (const [name, split] of Object.entries(analysis.bestSplits)) {
      if (
        split.duration > 0 &&
        isFinite(split.paceMinPerKm) &&
        split.paceMinPerKm > 0
      ) {
        console.log(
          `  ${name}: ${formatDuration(split.duration)} (${formatPace(split.paceMinPerKm)} /km)`,
        );
      }
    }

    if (cleanStats) {
      console.log(`\n清洗统计:`);
      console.log(`  移除漂移点: ${cleanStats.driftPointsRemoved}`);
      console.log(`  合并重复时间戳: ${cleanStats.duplicateTimestampsMerged}`);
    }

    if (options.output) {
      const report = exportSingleActivityReport(
        basename(input),
        analysis,
        cleanStats,
      );
      ensureDir(options.output);
      writeFileSync(options.output, report, "utf-8");
      console.log(`\n报告已保存到: ${options.output}`);
    }

    console.log("");
  });

program
  .command("summarize")
  .description("汇总多个 GPX 活动的统计")
  .argument("<input>", "GPX 文件目录")
  .option("-o, --output <dir>", "输出目录", "output")
  .option("--clean", "先清洗再分析", false)
  .action((input: string, options: any) => {
    const files = collectGpxFiles(input);

    if (files.length === 0) {
      console.log("未找到 GPX 文件");
      return;
    }

    console.log(`分析 ${files.length} 个 GPX 文件...\n`);

    const activities: ActivityRecord[] = [];
    let skipCount = 0;

    for (const file of files) {
      const data = loadGpxFile(file);
      if (!data || data.tracks.length === 0) {
        skipCount++;
        continue;
      }

      let tracks = data.tracks;

      if (options.clean) {
        tracks = data.tracks.map((track) => {
          const result = cleanTrack(track);
          return { ...track, segments: result.segments };
        });
      }

      const mainTrack = tracks[0];
      const analysis = analyzeTrack(mainTrack);
      const startTime = mainTrack.segments[0]?.points[0]?.time || new Date();

      const record = buildActivityRecord(basename(file), analysis, startTime);
      record.name = mainTrack.name;
      activities.push(record);

      console.log(
        `✅ ${basename(file)} - ${(analysis.totalDistance / 1000).toFixed(2)} km`,
      );
    }

    const summary = generateTrainingSummary(activities);

    console.log(`\n=== 汇总 ===\n`);
    console.log(`总活动数: ${summary.totalActivities}`);
    console.log(`总距离: ${(summary.totalDistance / 1000).toFixed(2)} km`);
    console.log(`总时长: ${formatDuration(summary.totalDuration)}`);
    console.log(`总爬升: ${summary.totalElevationGain.toFixed(1)} m`);
    console.log(`整体单调性: ${summary.overallMonotony.toFixed(2)}`);
    console.log(`周增幅风险: ${summary.weeklyIncreaseRisk}`);

    console.log(`\n周统计:`);
    for (const week of summary.weeklyStats) {
      console.log(
        `  ${week.weekStart}: ${(week.distance / 1000).toFixed(2)} km, ${week.activityCount} 次活动, 单调性: ${week.monotony.toFixed(2)}`,
      );
    }

    if (skipCount > 0) {
      console.log(`\n跳过: ${skipCount} 个文件`);
    }

    const csvPath = join(options.output, "summary.csv");
    const mdPath = join(options.output, "report.md");

    ensureDir(csvPath);

    writeFileSync(csvPath, exportCsvSummary(activities), "utf-8");
    writeFileSync(mdPath, exportMarkdownReport(activities, summary), "utf-8");

    console.log(`\nCSV 汇总: ${csvPath}`);
    console.log(`Markdown 报告: ${mdPath}`);
  });

program
  .command("export")
  .description("完整导出：清洗 + 分析 + 汇总")
  .argument("<input>", "GPX 文件目录")
  .option("-o, --output <dir>", "输出目录", "output")
  .action((input: string, options: any) => {
    const files = collectGpxFiles(input);

    if (files.length === 0) {
      console.log("未找到 GPX 文件");
      return;
    }

    console.log(`处理 ${files.length} 个 GPX 文件...\n`);

    const activities: ActivityRecord[] = [];
    let successCount = 0;
    let skipCount = 0;

    const cleanedDir = join(options.output, "cleaned");
    const reportsDir = join(options.output, "reports");

    for (const file of files) {
      const data = loadGpxFile(file);
      if (!data || data.tracks.length === 0) {
        skipCount++;
        continue;
      }

      const cleanedTracks: GpxTrack[] = [];
      let totalDrift = 0;
      let totalDup = 0;
      let totalGap = 0;
      let totalInterpolated = 0;

      for (const track of data.tracks) {
        const result = cleanTrack(track);
        cleanedTracks.push({
          ...track,
          segments: result.segments,
        });
        totalDrift += result.stats.driftPointsRemoved;
        totalDup += result.stats.duplicateTimestampsMerged;
        totalGap += result.stats.gapSegments;
        totalInterpolated += result.stats.interpolatedPoints;
      }

      const cleanedGpx = exportCleanedGpx(data, cleanedTracks);
      const cleanedPath = join(cleanedDir, basename(file));
      ensureDir(cleanedPath);
      writeFileSync(cleanedPath, cleanedGpx, "utf-8");

      const mainTrack = cleanedTracks[0];
      const analysis = analyzeTrack(mainTrack);
      const startTime = mainTrack.segments[0]?.points[0]?.time;

      if (
        !startTime ||
        isNaN(startTime.getTime()) ||
        analysis.totalDistance <= 0
      ) {
        console.log(`  跳过: ${basename(file)} (无效数据)`);
        skipCount++;
        continue;
      }

      const cleanStats = {
        originalPointCount: data.tracks.reduce(
          (sum, t) =>
            sum + t.segments.reduce((s, seg) => s + seg.points.length, 0),
          0,
        ),
        cleanedPointCount: cleanedTracks.reduce(
          (sum, t) =>
            sum + t.segments.reduce((s, seg) => s + seg.points.length, 0),
          0,
        ),
        driftPointsRemoved: totalDrift,
        duplicateTimestampsMerged: totalDup,
        pauseSegments: 0,
        gapSegments: totalGap,
        interpolatedPoints: totalInterpolated,
      };

      const report = exportSingleActivityReport(
        basename(file),
        analysis,
        cleanStats,
      );
      const reportPath = join(
        reportsDir,
        basename(file).replace(".gpx", ".md"),
      );
      ensureDir(reportPath);
      writeFileSync(reportPath, report, "utf-8");

      const record = buildActivityRecord(basename(file), analysis, startTime);
      record.name = mainTrack.name;
      activities.push(record);

      console.log(
        `✅ ${basename(file)} - ${(analysis.totalDistance / 1000).toFixed(2)} km`,
      );
      successCount++;
    }

    const summary = generateTrainingSummary(activities);

    const csvPath = join(options.output, "summary.csv");
    const mdPath = join(options.output, "report.md");

    ensureDir(csvPath);
    writeFileSync(csvPath, exportCsvSummary(activities), "utf-8");
    writeFileSync(mdPath, exportMarkdownReport(activities, summary), "utf-8");

    console.log(`\n完成: ${successCount} 成功, ${skipCount} 跳过`);
    console.log(`\n输出目录: ${options.output}`);
    console.log(`  - 清洗后 GPX: ${cleanedDir}/`);
    console.log(`  - 单活动报告: ${reportsDir}/`);
    console.log(`  - CSV 汇总: ${csvPath}`);
    console.log(`  - 总报告: ${mdPath}`);
  });

program.parse(process.argv);
