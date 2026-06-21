import { XMLParser, XMLBuilder } from "fast-xml-parser";
import {
  GpxData,
  GpxPoint,
  GpxTrack,
  GpxTrackSegment,
  GpxMetadata,
} from "./types.js";

export function parseGpx(xmlContent: string): GpxData {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    parseAttributeValue: false,
    textNodeName: "#text",
  });

  const parsed = parser.parse(xmlContent);
  const gpx = parsed.gpx;

  if (!gpx) {
    throw new Error("Invalid GPX file: missing root gpx element");
  }

  const metadata = parseMetadata(gpx.metadata);
  const tracks = parseTracks(gpx.trk);
  const waypoints = gpx.wpt ? parseWaypoints(gpx.wpt) : undefined;

  return {
    metadata,
    tracks,
    waypoints,
  };
}

function parseMetadata(meta: any): GpxMetadata | undefined {
  if (!meta) return undefined;

  return {
    name: meta.name || undefined,
    time: meta.time ? new Date(meta.time) : undefined,
    desc: meta.desc || undefined,
  };
}

function parseTracks(trk: any): GpxTrack[] {
  if (!trk) return [];

  const trackArray = Array.isArray(trk) ? trk : [trk];
  return trackArray.map((t) => ({
    name: t.name || undefined,
    type: t.type || undefined,
    segments: parseSegments(t.trkseg),
  }));
}

function parseSegments(trkseg: any): GpxTrackSegment[] {
  if (!trkseg) return [];

  const segArray = Array.isArray(trkseg) ? trkseg : [trkseg];
  return segArray.map((seg) => ({
    points: parsePoints(seg.trkpt),
  }));
}

function parsePoints(trkpt: any): GpxPoint[] {
  if (!trkpt) return [];

  const ptArray = Array.isArray(trkpt) ? trkpt : [trkpt];
  return ptArray.map((pt) => parsePoint(pt));
}

function parsePoint(pt: any): GpxPoint {
  const point: GpxPoint = {
    lat: parseFloat(pt["@_lat"]),
    lon: parseFloat(pt["@_lon"]),
  };

  if (pt.ele !== undefined) {
    point.ele = parseFloat(pt.ele);
  }

  if (pt.time) {
    point.time = new Date(pt.time);
  }

  const extensions = pt.extensions;
  if (extensions) {
    const trackPointExt =
      extensions["gpxtpx:TrackPointExtension"] ||
      extensions.TrackPointExtension;
    if (trackPointExt) {
      if (
        trackPointExt["gpxtpx:hr"] !== undefined ||
        trackPointExt.hr !== undefined
      ) {
        point.hr = parseInt(trackPointExt["gpxtpx:hr"] || trackPointExt.hr, 10);
      }
      if (
        trackPointExt["gpxtpx:cad"] !== undefined ||
        trackPointExt.cad !== undefined
      ) {
        point.cad = parseInt(
          trackPointExt["gpxtpx:cad"] || trackPointExt.cad,
          10,
        );
      }
    }
  }

  return point;
}

function parseWaypoints(wpt: any): GpxPoint[] {
  if (!wpt) return [];
  const ptArray = Array.isArray(wpt) ? wpt : [wpt];
  return ptArray.map((pt) => parsePoint(pt));
}

export function writeGpx(data: GpxData): string {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    format: true,
    indentBy: "  ",
    suppressEmptyNode: true,
  });

  const gpx: any = {
    "@_version": "1.1",
    "@_creator": "gpx-cleaner",
    "@_xmlns": "http://www.topografix.com/GPX/1/1",
    "@_xmlns:gpxtpx": "http://www.garmin.com/xmlschemas/TrackPointExtension/v1",
  };

  if (data.metadata) {
    gpx.metadata = buildMetadata(data.metadata);
  }

  if (data.tracks && data.tracks.length > 0) {
    gpx.trk = data.tracks.map(buildTrack);
  }

  if (data.waypoints && data.waypoints.length > 0) {
    gpx.wpt = data.waypoints.map((wp) => buildPoint(wp, "wpt"));
  }

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build({ gpx });
}

function buildMetadata(meta: GpxMetadata): any {
  const obj: any = {};
  if (meta.name) obj.name = meta.name;
  if (meta.time && !isNaN(meta.time.getTime()))
    obj.time = meta.time.toISOString();
  if (meta.desc) obj.desc = meta.desc;
  return obj;
}

function buildTrack(track: GpxTrack): any {
  const obj: any = {};
  if (track.name) obj.name = track.name;
  if (track.type) obj.type = track.type;
  if (track.segments && track.segments.length > 0) {
    obj.trkseg = track.segments.map((seg) => ({
      trkpt: seg.points.map((pt) => buildPoint(pt, "trkpt")),
    }));
  }
  return obj;
}

function buildPoint(point: GpxPoint, tagName: "wpt" | "trkpt"): any {
  const obj: any = {
    "@_lat": point.lat.toString(),
    "@_lon": point.lon.toString(),
  };

  if (point.ele !== undefined) {
    obj.ele = point.ele.toString();
  }

  if (point.time && !isNaN(point.time.getTime())) {
    obj.time = point.time.toISOString();
  }

  if (point.hr !== undefined || point.cad !== undefined) {
    const ext: any = {};
    if (point.hr !== undefined) ext["gpxtpx:hr"] = point.hr.toString();
    if (point.cad !== undefined) ext["gpxtpx:cad"] = point.cad.toString();
    obj.extensions = {
      "gpxtpx:TrackPointExtension": ext,
    };
  }

  return obj;
}

export function validateGpx(xmlContent: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  try {
    const data = parseGpx(xmlContent);

    if (!data.tracks || data.tracks.length === 0) {
      errors.push("No tracks found in GPX file");
    }

    let totalPoints = 0;
    for (const track of data.tracks) {
      if (!track.segments || track.segments.length === 0) {
        errors.push(`Track "${track.name || "unnamed"}" has no segments`);
        continue;
      }

      for (const seg of track.segments) {
        totalPoints += seg.points.length;

        for (let i = 0; i < seg.points.length; i++) {
          const pt = seg.points[i];
          if (isNaN(pt.lat) || isNaN(pt.lon)) {
            errors.push(`Point ${i} has invalid coordinates`);
          }
          if (pt.lat < -90 || pt.lat > 90) {
            errors.push(`Point ${i} has invalid latitude: ${pt.lat}`);
          }
          if (pt.lon < -180 || pt.lon > 180) {
            errors.push(`Point ${i} has invalid longitude: ${pt.lon}`);
          }
          if (pt.time && isNaN(pt.time.getTime())) {
            errors.push(`Point ${i} has invalid timestamp`);
          }
        }
      }
    }

    if (totalPoints === 0) {
      errors.push("No track points found");
    }
  } catch (e: any) {
    errors.push(`Parse error: ${e.message}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
