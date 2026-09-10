(function (A) {
  "use strict";

  const U = A.Utils;
  const C = () => A.CONFIG.fireDetection || {};

  function number(value) {
    const out = Number(value);
    return Number.isFinite(out) ? out : null;
  }

  function time(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const out = Date.parse(value || "");
    return Number.isFinite(out) ? out : NaN;
  }

  function sourceFamily(observation) {
    const sourceId = String(observation.sourceId || "").toLowerCase();
    const product = String(observation.product || "").toLowerCase();
    const sensor = String(observation.sensor || "").toLowerCase();
    if (sourceId.includes("mtg") || product.includes("mtg") || sensor === "fci") return "mtg";
    if (sourceId.includes("slstr") || product.includes("slstr") || sensor.includes("slstr")) return "slstr";
    if (product.includes("modis") || sensor.includes("modis")) return "modis";
    // NOAA-20, NOAA-21 and Suomi-NPP are distinct platforms but one VIIRS
    // sensor family for independent-confirmation purposes.
    if (sourceId.includes("firms") || product.includes("viirs") || sensor.includes("viirs")) return "viirs";
    return observation.sensorFamily || "unknown";
  }

  function observationKey(d) {
    return [
      d.sourceId || "",
      d.product || "",
      d.satellite || "",
      d.detectedAt ? String(d.detectedAt).slice(0, 16) : "",
      Number(d.lat).toFixed(4),
      Number(d.lon).toFixed(4),
    ].join("|");
  }

  function cleanObservations(observations, countryCode, referenceTime) {
    const trackingMs = (C().eventTrackingHours || 48) * 3600e3;
    const endMs = time(referenceTime) || Date.now();
    const startMs = endMs - trackingMs;
    const seen = new Map();
    for (const raw of observations || []) {
      if (!raw) continue;
      const lat = number(raw.lat), lon = number(raw.lon), detectedAt = raw.detectedAt;
      const detectedMs = time(detectedAt);
      if (lat == null || lon == null || !Number.isFinite(detectedMs)) continue;
      if (detectedMs < startMs || detectedMs > endMs) continue;
      if (countryCode && raw.countryCode && raw.countryCode !== countryCode) continue;
      const frpMw = number(raw.frpMw ?? raw.frp);
      const copy = {
        ...raw,
        lat,
        lon,
        detectedAt: new Date(detectedMs).toISOString(),
        frpMw,
        frp: frpMw,
        sensorFamily: sourceFamily(raw),
        countryCode: raw.countryCode || countryCode,
      };
      const key = observationKey(copy);
      const previous = seen.get(key);
      if (!previous || (frpMw ?? -Infinity) > (previous.frpMw ?? -Infinity)) seen.set(key, copy);
    }
    return [...seen.values()].sort(
      (a, b) => time(a.detectedAt) - time(b.detectedAt) || (b.frpMw || 0) - (a.frpMw || 0),
    );
  }

  function canJoin(cluster, observation) {
    const settings = C().association || {};
    const maxGapMs = (settings.maxGapHours || 6) * 3600e3;
    const radiusKm = settings.radiusKm || 5;
    const maxDiameterKm = settings.maxClusterDiameterKm || 8;
    const observedAt = time(observation.detectedAt);
    if (observedAt - cluster.lastSeenMs > maxGapMs) return false;
    if (U.haversineKm(cluster.center, observation) > radiusKm) return false;
    // Complete-link guard: avoids A—B—C transitive chains producing one
    // country-scale "event" merely because adjacent observations are close.
    return cluster.observations.every(
      (member) => U.haversineKm(member, observation) <= maxDiameterKm,
    );
  }

  function clusterObservations(observations) {
    const clusters = [];
    for (const observation of observations) {
      let chosen = null;
      let distance = Infinity;
      for (const cluster of clusters) {
        if (!canJoin(cluster, observation)) continue;
        const d = U.haversineKm(cluster.center, observation);
        if (d < distance) {
          distance = d;
          chosen = cluster;
        }
      }
      if (!chosen) {
        clusters.push({
          observations: [observation],
          center: { lat: observation.lat, lon: observation.lon },
          firstSeenMs: time(observation.detectedAt),
          lastSeenMs: time(observation.detectedAt),
        });
        continue;
      }
      chosen.observations.push(observation);
      chosen.lastSeenMs = Math.max(chosen.lastSeenMs, time(observation.detectedAt));
      const weights = chosen.observations.map((item) => Math.max(1, item.frpMw || 0));
      const total = weights.reduce((sum, value) => sum + value, 0);
      chosen.center = {
        lat: chosen.observations.reduce((sum, item, index) => sum + item.lat * weights[index], 0) / total,
        lon: chosen.observations.reduce((sum, item, index) => sum + item.lon * weights[index], 0) / total,
      };
    }
    return clusters;
  }

  function trendFor(observations, family) {
    const rows = observations
      .filter((item) => !family || item.sensorFamily === family)
      .filter((item) => item.frpMw != null)
      .sort((a, b) => time(a.detectedAt) - time(b.detectedAt));
    const latest = rows.at(-1) || null;
    const atDelta = (minutes) => {
      if (!latest) return null;
      const target = time(latest.detectedAt) - minutes * 60e3;
      const before = rows.filter((item) => time(item.detectedAt) <= target).at(-1);
      return before ? latest.frpMw - before.frpMw : null;
    };
    let consecutive = 0, previous = null;
    for (const row of rows) {
      if (!previous || time(row.detectedAt) - time(previous.detectedAt) <= 15 * 60e3) consecutive++;
      else consecutive = 1;
      previous = row;
    }
    const rolling = rows.slice(-3).map((item) => item.frpMw).sort((a, b) => a - b);
    const rollingMedian = rolling.length ? rolling[Math.floor(rolling.length / 2)] : null;
    return {
      currentFrp: latest?.frpMw ?? null,
      deltaFrp10: atDelta(10),
      deltaFrp20: atDelta(20),
      deltaFrp30: atDelta(30),
      rollingMedian,
      consecutiveFrames: consecutive,
      growing: [atDelta(10), atDelta(20), atDelta(30)].some((value) => value != null && value > 0),
    };
  }

  function activityFor(observations) {
    const rows = (observations || []).filter((item) => Number.isFinite(time(item.detectedAt)));
    const latestMs = Math.max(...rows.map((item) => time(item.detectedAt)));
    if (!Number.isFinite(latestMs))
      return { activePixelCount: 0, activeThermalAreaKm2: null, pixelGrowth: null, thermalAreaGrowthKm2: null, members: [] };
    const windowMs = (C().activeThermalArea?.observationMinutes || 60) * 60e3;
    const current = rows.filter((item) => time(item.detectedAt) > latestMs - windowMs && time(item.detectedAt) <= latestMs);
    const previous = rows.filter((item) => time(item.detectedAt) > latestMs - windowMs * 2 && time(item.detectedAt) <= latestMs - windowMs);
    const area = (items) => {
      const values = items.map((item) => number(item.effectivePixelAreaKm2)).filter((value) => value != null && value > 0);
      return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    const activeThermalAreaKm2 = area(current);
    const previousThermalAreaKm2 = area(previous);
    return {
      activePixelCount: current.length,
      activeThermalAreaKm2,
      previousPixelCount: previous.length,
      previousThermalAreaKm2,
      pixelGrowth: previous.length ? current.length - previous.length : null,
      thermalAreaGrowthKm2: activeThermalAreaKm2 != null && previousThermalAreaKm2 != null
        ? activeThermalAreaKm2 - previousThermalAreaKm2
        : null,
      members: current,
    };
  }

  function geometryCenter(feature) {
    const geom = feature?.geometry;
    if (!geom) return null;
    if (geom.type === "Point") {
      const [lon, lat] = geom.coordinates || [];
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    }
    const coords = geom.coordinates?.flat?.(Infinity) || [];
    const numbers = coords.filter(Number.isFinite);
    if (numbers.length < 2) return null;
    let lat = 0, lon = 0, count = 0;
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      lon += numbers[i];
      lat += numbers[i + 1];
      count++;
    }
    return count ? { lat: lat / count, lon: lon / count } : null;
  }

  function staticMatch(event, features) {
    let best = null;
    for (const feature of features || []) {
      const p = feature.properties || feature;
      const center = geometryCenter(feature) ||
        (Number.isFinite(p.lat) && Number.isFinite(p.lon) ? { lat: Number(p.lat), lon: Number(p.lon) } : null);
      if (!center) continue;
      const distanceKm = U.haversineKm(event, center);
      const radiusKm = number(p.radiusKm ?? p.radius_km) ?? 0.75;
      if (distanceKm > radiusKm || (best && distanceKm >= best.distanceKm)) continue;
      best = { feature, properties: p, center, radiusKm, distanceKm };
    }
    return best;
  }

  function staticOverride(event, match) {
    if (!match) return { override: false, reasons: [] };
    const p = match.properties;
    const settings = C().staticSource || {};
    const current = event.currentFrp ?? event.peakFrp;
    const p99 = number(p.p99FrpMw ?? p.p99_frp_mw);
    const median = number(p.medianFrpMw ?? p.median_frp_mw);
    const mad = number(p.frpMadMw ?? p.frp_mad_mw);
    const robustZ = median != null && mad != null && mad > 0
      ? (current - median) / (1.4826 * mad)
      : null;
    const reasons = [];
    if (p99 != null && current != null && current >= p99 * (settings.anomalyP99Multiplier || 1.35)) reasons.push("frp_p99");
    if (robustZ != null && robustZ >= (settings.anomalyMadMultiplier || 4)) reasons.push("frp_mad");
    if (event.frpTrend?.growing && Math.max(event.frpTrend.deltaFrp10 || 0, event.frpTrend.deltaFrp20 || 0, event.frpTrend.deltaFrp30 || 0) >= (settings.minFrpGrowthMw || 10)) reasons.push("frp_growth");
    if (event.activeThermal?.pixelGrowth != null && event.activeThermal.pixelGrowth >= (settings.minActivePixelGrowth || 2)) reasons.push("pixel_growth");
    if (event.activeThermal?.thermalAreaGrowthKm2 != null && event.activeThermal.thermalAreaGrowthKm2 >= (settings.minThermalAreaGrowthKm2 || 1)) reasons.push("thermal_area_growth");
    if (event.independentSensorCount >= (settings.overrideIndependentFamilies || 2)) reasons.push("independent_sensors");
    const normalDayOnly = number(p.dayCount ?? p.day_count) > 0 && number(p.nightCount ?? p.night_count) === 0;
    const latestAtNight = event.latestObservation?.dayNight === "night";
    if (normalDayOnly && latestAtNight) reasons.push("night_anomaly");
    const outsideNormalFootprint = (event.activeThermal?.members || []).some(
      (item) => U.haversineKm(item, match.center) > match.radiusKm,
    );
    if (outsideNormalFootprint) reasons.push("spatial_novelty");
    return { override: reasons.length > 0, reasons, robustZ };
  }

  function confidenceFor(event, referenceMs, staticInfo) {
    const cfg = C().confidence || {};
    const ageMinutes = Math.max(0, (referenceMs - time(event.latestDetectedAt)) / 60000);
    let score = 25; // direct thermal observation is the necessary first signal
    if (ageMinutes <= (cfg.freshMinutes || 60)) score += 20;
    else if (ageMinutes <= (cfg.recentMinutes || 180)) score += 12;
    else score += 4;
    score += Math.min(15, Math.max(0, event.observationCount - 1) * 4);
    const confidences = event.observations
      .map((item) => number(item.confidenceNormalized ?? item.confidenceRaw))
      .filter((value) => value != null);
    if (confidences.length) {
      const mean = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
      score += mean <= 1 ? mean * 10 : Math.min(10, mean / 10);
    }
    if (event.frpTrend.growing) score += 10;
    if ((event.activeThermal?.pixelGrowth || 0) > 0 || (event.activeThermal?.thermalAreaGrowthKm2 || 0) > 0) score += 4;
    if (event.frpTrend.consecutiveFrames >= (cfg.growingMtgFrames || 3)) score += 8;
    if (event.independentSensorCount >= 2) score += 22;
    if (event.independentSensorCount >= 3) score += 8;
    if (staticInfo?.override) score += 8;
    score = Math.max(0, Math.min(100, Math.round(score)));
    let state = "WATCH";
    // A lone low-FRP pixel can be watched, but cannot become PROBABLE on its
    // own.  Persistence, growth or independent confirmation is required.
    const corroborated = event.observationCount >= 2 || event.frpTrend.growing || event.independentSensorCount >= 2;
    if (score >= (cfg.highConfidence || 70) && (event.independentSensorCount >= 2 || event.frpTrend.consecutiveFrames >= 3)) state = "HIGH_CONFIDENCE";
    else if (score >= (cfg.probable || 50) && corroborated) state = "PROBABLE";
    if (event.staticSource && !staticInfo.override) state = "STATIC_SUPPRESSED";
    return { score, state, ageMinutes };
  }

  class FireDetectionEngine {
    constructor() {
      this.tracks = new Map();
      this.sequence = 0;
      this.staticFeatures = [];
      this.staticDatasetStatus = "unavailable";
    }

    setPersistentThermalSources(data) {
      this.staticFeatures = Array.isArray(data?.features) ? data.features : Array.isArray(data) ? data : [];
      this.staticDatasetStatus = this.staticFeatures.length ? "ready" : "empty";
    }

    reset(countryCode) {
      if (!countryCode) {
        this.tracks.clear();
        return;
      }
      for (const [id, track] of this.tracks)
        if (track.countryCode === countryCode) this.tracks.delete(id);
    }

    matchingTrack(cluster, countryCode, claimedTrackIds = new Set()) {
      const trackingMs = (C().eventTrackingHours || 48) * 3600e3;
      let match = null;
      for (const track of this.tracks.values()) {
        if (track.countryCode !== countryCode) continue;
        if (claimedTrackIds.has(track.id)) continue;
        if (cluster.firstSeenMs - track.lastSeenMs > trackingMs || track.firstSeenMs - cluster.lastSeenMs > trackingMs) continue;
        const d = U.haversineKm(cluster.center, track);
        if (d <= (C().association?.radiusKm || 5) && (!match || d < match.distanceKm)) match = { track, distanceKm: d };
      }
      return match?.track || null;
    }

    eventId(cluster, countryCode, claimedTrackIds) {
      const track = this.matchingTrack(cluster, countryCode, claimedTrackIds);
      if (track) {
        claimedTrackIds?.add(track.id);
        return { id: track.id, track };
      }
      this.sequence++;
      return {
        id: `${countryCode}-fire-${new Date(cluster.firstSeenMs).toISOString().slice(0, 10).replaceAll("-", "")}-${this.sequence.toString(36)}`,
        track: null,
      };
    }

    rebuild({ observations = [], countryCode, selectedTime } = {}) {
      const referenceMs = time(selectedTime) || Date.now();
      const cleaned = cleanObservations(observations, countryCode, referenceMs);
      const clusters = clusterObservations(cleaned);
      const claimedTrackIds = new Set();
      const events = clusters.map((cluster) => {
        const rows = cluster.observations;
        const identity = this.eventId(cluster, countryCode || rows[0]?.countryCode || "TR", claimedTrackIds);
        const previous = identity.track;
        const latestObservation = rows.at(-1);
        const frps = rows.map((item) => item.frpMw).filter((value) => value != null);
        const families = [...new Set(rows.map(sourceFamily))].filter((value) => value && value !== "unknown").sort();
        const sources = [...new Set(rows.map((item) => item.sourceId).filter(Boolean))].sort();
        const platforms = [...new Set(rows.map((item) => item.satellite || item.platform).filter(Boolean))].sort();
        const frpTrend = trendFor(rows);
        const mtgTrend = trendFor(rows, "mtg");
        const activeThermal = activityFor(rows);
        const peakFrp = frps.length ? Math.max(...frps) : null;
        const currentFrp = latestObservation?.frpMw ?? peakFrp;
        const event = {
          id: identity.id,
          countryCode: countryCode || rows[0]?.countryCode || "TR",
          lat: cluster.center.lat,
          lon: cluster.center.lon,
          observations: rows,
          members: rows,
          count: rows.length,
          observationCount: rows.length,
          firstSeen: new Date(Math.min(previous?.firstSeenMs ?? Infinity, cluster.firstSeenMs)).toISOString(),
          lastSeen: new Date(Math.max(previous?.lastSeenMs ?? -Infinity, cluster.lastSeenMs)).toISOString(),
          detectedAt: new Date(Math.min(previous?.firstSeenMs ?? Infinity, cluster.firstSeenMs)).toISOString(),
          earliestDetectedAt: new Date(Math.min(previous?.firstSeenMs ?? Infinity, cluster.firstSeenMs)).toISOString(),
          latestDetectedAt: new Date(Math.max(previous?.lastSeenMs ?? -Infinity, cluster.lastSeenMs)).toISOString(),
          latestObservationAt: new Date(Math.max(previous?.lastSeenMs ?? -Infinity, cluster.lastSeenMs)).toISOString(),
          latestObservation,
          representative: rows.reduce((best, item) => (item.frpMw || 0) > (best?.frpMw || 0) ? item : best, rows[0]),
          currentFrp,
          peakFrp,
          maxFrp: peakFrp || 0,
          maxFrpMw: peakFrp,
          supportingSources: sources,
          supportingPlatforms: platforms,
          sensorFamilies: families,
          independentSensorCount: families.length,
          frpTrend,
          mtg: mtgTrend,
          activeThermal,
          activePixelCount: activeThermal.activePixelCount,
          activeThermalAreaKm2: activeThermal.activeThermalAreaKm2,
        };
        const match = staticMatch(event, this.staticFeatures);
        const matchClass = match
          ? match.properties.classification || match.properties.staticClass || "PERSISTENT_UNKNOWN"
          : null;
        // Only facility-evidenced static classes suppress.  PERSISTENT_UNKNOWN
        // (or any unrecognized class) is persistence evidence, never a hard
        // suppression: a new real fire must not become STATIC_SUPPRESSED.
        const hardStatic = !!match && (matchClass === "STATIC_INDUSTRIAL" || matchClass === "STATIC_SOLAR_GLINT");
        if (hardStatic) {
          event.staticSource = {
            classification: matchClass,
            distanceKm: match.distanceKm,
            metrics: match.properties,
          };
          event.persistenceEvidence = null;
        } else if (match) {
          event.staticSource = null;
          event.persistenceEvidence = {
            classification: matchClass,
            distanceKm: match.distanceKm,
            metrics: match.properties,
          };
        } else {
          event.staticSource = null;
          event.persistenceEvidence = null;
        }
        const staticInfo = hardStatic ? staticOverride(event, match) : { override: false, reasons: [], robustZ: null };
        event.staticOverride = staticInfo;
        const confidence = confidenceFor(event, referenceMs, staticInfo);
        event.fireDetectionScore = confidence.score;
        event.confidence = confidence.score;
        event.state = confidence.state;
        event.observationAgeMinutes = confidence.ageMinutes;
        return event;
      });
      const trackingMs = (C().eventTrackingHours || 48) * 3600e3;
      for (const [id, track] of this.tracks)
        if (referenceMs - track.lastSeenMs > trackingMs) this.tracks.delete(id);
      for (const event of events) {
        const old = this.tracks.get(event.id);
        this.tracks.set(event.id, {
          id: event.id,
          countryCode: event.countryCode,
          lat: event.lat,
          lon: event.lon,
          firstSeenMs: old ? Math.min(old.firstSeenMs, time(event.firstSeen)) : time(event.firstSeen),
          lastSeenMs: time(event.lastSeen),
          snapshot: event,
        });
      }
      const liveIds = new Set(events.map((event) => event.id));
      const staleMs = (C().staleHighConfidenceMinutes || 180) * 60e3;
      for (const track of this.tracks.values()) {
        if (track.countryCode !== countryCode || liveIds.has(track.id)) continue;
        if (!track.snapshot || track.snapshot.state !== "HIGH_CONFIDENCE") continue;
        if (referenceMs - track.lastSeenMs > staleMs) continue;
        events.push({
          ...track.snapshot,
          state: "STALE",
          staleFromState: "HIGH_CONFIDENCE",
          isStaleFallback: true,
          observationAgeMinutes: Math.max(0, Math.round((referenceMs - track.lastSeenMs) / 60000)),
        });
      }
      return events.sort((a, b) => time(b.latestDetectedAt) - time(a.latestDetectedAt));
    }

    visibleEvents(events, selectedTime) {
      const endMs = time(selectedTime) || Date.now();
      const cfg = C();
      const startMs = endMs - (cfg.visibleObservationHours || 3) * 3600e3;
      const staleMs = (cfg.staleHighConfidenceMinutes || 180) * 60e3;
      return (events || []).filter((event) => {
        if (event.state === "STATIC_SUPPRESSED" || event.state === "CLOSED") return false;
        const latest = time(event.latestObservationAt || event.latestDetectedAt);
        if (latest >= startMs && latest <= endMs) return true;
        return (event.state === "HIGH_CONFIDENCE" || event.state === "STALE") && latest <= endMs && latest >= endMs - staleMs;
      });
    }
  }

  A.FireDetectionEngine = FireDetectionEngine;
  A.FireDetection = { sourceFamily, cleanObservations, clusterObservations, staticOverride };
})(window.AtmoApp);
