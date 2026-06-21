import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseGpx, validateGpx, writeGpx } from "../src/gpx.js";

const samplesDir = join(process.cwd(), "samples");

describe("gpx", () => {
  describe("parseGpx", () => {
    it("should parse a valid GPX file", () => {
      const content = readFileSync(join(samplesDir, "normal-run.gpx"), "utf-8");
      const data = parseGpx(content);

      expect(data.tracks.length).toBeGreaterThan(0);
      expect(data.tracks[0].segments.length).toBeGreaterThan(0);
      expect(data.tracks[0].segments[0].points.length).toBeGreaterThan(0);
      expect(data.metadata?.name).toBeDefined();
    });

    it("should parse coordinates as numbers", () => {
      const content = readFileSync(join(samplesDir, "normal-run.gpx"), "utf-8");
      const data = parseGpx(content);

      const point = data.tracks[0].segments[0].points[0];
      expect(typeof point.lat).toBe("number");
      expect(typeof point.lon).toBe("number");
    });

    it("should parse elevation and time", () => {
      const content = readFileSync(join(samplesDir, "normal-run.gpx"), "utf-8");
      const data = parseGpx(content);

      const point = data.tracks[0].segments[0].points[0];
      expect(point.ele).toBeDefined();
      expect(typeof point.ele).toBe("number");
      expect(point.time).toBeDefined();
      expect(point.time).toBeInstanceOf(Date);
    });

    it("should throw for invalid GPX", () => {
      expect(() => parseGpx("not valid xml")).toThrow();
    });
  });

  describe("validateGpx", () => {
    it("should validate a normal GPX file", () => {
      const content = readFileSync(join(samplesDir, "normal-run.gpx"), "utf-8");
      const result = validateGpx(content);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("should detect corrupt GPX with invalid coords", () => {
      const content = readFileSync(join(samplesDir, "corrupt.gpx"), "utf-8");
      const result = validateGpx(content);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should detect invalid latitude range", () => {
      const gpx = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="91" lon="0"><time>2025-01-01T00:00:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
      const result = validateGpx(gpx);
      expect(result.valid).toBe(false);
    });

    it("should detect empty tracks", () => {
      const gpx = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
</gpx>`;
      const result = validateGpx(gpx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("No tracks"))).toBe(true);
    });
  });

  describe("writeGpx", () => {
    it("should write valid GPX that can be parsed back", () => {
      const content = readFileSync(join(samplesDir, "normal-run.gpx"), "utf-8");
      const data = parseGpx(content);
      const written = writeGpx(data);
      const reparsed = parseGpx(written);

      expect(reparsed.tracks.length).toBe(data.tracks.length);
      expect(reparsed.tracks[0].segments[0].points.length).toBe(
        data.tracks[0].segments[0].points.length,
      );
    });

    it("should preserve track name", () => {
      const content = readFileSync(join(samplesDir, "normal-run.gpx"), "utf-8");
      const data = parseGpx(content);
      const written = writeGpx(data);
      const reparsed = parseGpx(written);

      expect(reparsed.tracks[0].name).toBe(data.tracks[0].name);
    });
  });

  describe("pause-drift sample", () => {
    it("should parse pause drift sample", () => {
      const content = readFileSync(
        join(samplesDir, "pause-drift-run.gpx"),
        "utf-8",
      );
      const data = parseGpx(content);
      expect(data.tracks.length).toBe(1);
      expect(data.tracks[0].segments[0].points.length).toBeGreaterThan(10);
    });
  });

  describe("midnight ride sample", () => {
    it("should parse midnight ride sample", () => {
      const content = readFileSync(
        join(samplesDir, "midnight-ride.gpx"),
        "utf-8",
      );
      const data = parseGpx(content);
      expect(data.tracks.length).toBe(1);

      const points = data.tracks[0].segments[0].points;
      const first = points[0];
      const last = points[points.length - 1];

      expect(first.time).toBeDefined();
      expect(last.time).toBeDefined();
      expect(last.time!.getTime() - first.time!.getTime()).toBeGreaterThan(0);
    });

    it("跨午夜活动应正确包含跨天时间", () => {
      const content = readFileSync(
        join(samplesDir, "midnight-ride.gpx"),
        "utf-8",
      );
      const data = parseGpx(content);

      const points = data.tracks[0].segments[0].points;
      const dates = points.map((p) => p.time?.getUTCDate());

      const uniqueDays = new Set(dates.filter(Boolean));
      expect(uniqueDays.size).toBe(2);
    });
  });
});
