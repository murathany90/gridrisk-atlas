(function (A) {
  const U = A.Utils,
    C = A.CONFIG,
    I = A.I18n;
  function baseName(state) {
    const code = state.countryCode || C.activeCountryCode || "TR";
    return `gridrisk-atlas_${code}_${new Date().toISOString().slice(0, 10)}`;
  }
  function metadata(state) {
    const country =
      A.COUNTRIES[state.countryCode || C.activeCountryCode] || A.COUNTRIES.TR;
    return {
      applicationName: C.appName,
      app: C.appName,
      version: C.appVersion,
      language: I.locale,
      exportedAt: new Date().toISOString(),
      countryCode: country.code,
      countryName: I.countryName(country.code),
      coverage: I.countryCoverage(country.code),
      timezone: country.timezone,
      domain: C.regionBounds,
      selectedTime: state.selectedTime?.toISOString?.() || null,
      fireSource: "NASA FIRMS",
      smokeSource: "CAMS European Air Quality via Open-Meteo",
      weatherSource: "Open-Meteo",
      gridSource: "OpenStreetMap",
      gridAttribution: "© OpenStreetMap contributors / ODbL 1.0",
      gridManifest: state.countryManifest || null,
      clustering: C.fireClustering,
      warning:
        "Fire-event clusters, distance bands, downwind sectors and risk scores are operational screening aids, not official safety distances, fire perimeters, smoke trajectories or outage probabilities.",
    };
  }
  A.ExportManager = {
    csv(state) {
      const country =
          A.COUNTRIES[state.countryCode || C.activeCountryCode] ||
          A.COUNTRIES.TR,
        rows = [
          [
            "countryCode",
            "countryName",
            "eventId",
            "latestDetectedAt",
            "lat",
            "lon",
            "hotspotCount",
            "maxFrp_MW",
            "riskScore",
            "riskLevel",
            "nearestGridKm",
            "assetId",
            "gridClass",
            "actualVoltageKv",
            "displayLabel",
            "nearestAsset",
            "downwindAlignment",
            "corridorDistanceKm",
            "corridorWindSpeedKmh",
            "corridorWindSource",
            "corridorConfidence",
            "affectedLines10km",
            "affectedSubstations10km",
            "triggerDetectionId",
            "triggerSource",
            "triggerSatellite",
            "triggerInstrument",
            "triggerProduct",
            "triggerDetectedAt",
            "triggerFrpMw",
            "triggerConfidence",
            "triggerLatitude",
            "triggerLongitude",
            "triggerDistanceKm",
            "nearestLineLatitude",
            "nearestLineLongitude",
            "eventCenterLatitude",
            "eventCenterLongitude",
            "evidenceCount",
            "selectionRule",
          ],
        ];
      for (const a of state.fireImpacts || []) {
        if (a.event?.countryCode !== country.code) continue;
        const obj = a.nearestLine || a.nearest?.line,
          props = obj?.feature?.props || {},
          level = a.riskBand?.level || "watch",
          ev = a.evidence || null;
        rows.push([
          country.code,
          I.countryName(country.code),
          a.event.id,
          a.event.latestDetectedAt,
          a.event.lat,
          a.event.lon,
          a.event.count,
          U.round(a.event.maxFrp, 2),
          a.riskScore,
          I.t(`risk.${level}`),
          obj ? U.round(obj.distanceKm, 3) : "",
          props.assetId || "",
          props.gridClass || "",
          props.actualVoltageKv ?? "",
          props.displayLabel || "",
          obj ? "line" : "",
          a.downwindAlignment ? "yes" : "no",
          a.corridorDistanceKm ?? "",
          a.corridorWindSpeedKmh ?? "",
          a.corridorWindSource || "",
          a.corridorConfidence || "",
          a.affectedLines?.length || 0,
          a.affectedSubstations?.length || 0,
          ev?.triggerDetectionId ?? "",
          ev?.triggerSource ?? "",
          ev?.triggerSatellite ?? "",
          ev?.triggerInstrument ?? "",
          ev?.triggerProduct ?? "",
          ev?.triggerDetectedAt ?? "",
          ev?.triggerFrpMw ?? "",
          ev?.triggerConfidence ?? "",
          ev?.triggerLatitude ?? "",
          ev?.triggerLongitude ?? "",
          ev?.triggerDistanceKm ?? "",
          ev?.nearestLineLatitude ?? "",
          ev?.nearestLineLongitude ?? "",
          ev?.eventCenterLatitude ?? "",
          ev?.eventCenterLongitude ?? "",
          ev?.evidenceCount ?? "",
          ev?.selectionRule ?? "",
        ]);
      }
      const text = rows
        .map((row) => row.map(U.csvEscape).join(","))
        .join("\r\n");
      U.download(
        `${baseName(state)}.csv`,
        "text/csv;charset=utf-8",
        "\ufeff" + text,
      );
    },
    json(state) {
      U.download(
        `${baseName(state)}.json`,
        "application/json",
        JSON.stringify(
          {
            metadata: metadata(state),
            fires: state.fireData || [],
            fireEvents: state.fireEvents || [],
            fireGridImpacts: state.fireImpacts || [],
            smokeLayer: {
              variable: state.smokeVariable,
              data: state.smokeData || [],
            },
            wildfirePm10Summary: state.wildfireSummaryData || [],
            wind: {
              level: state.windLevel,
              data: state.windData || [],
              surfaceWindData: state.surfaceWindData || [],
            },
            selectedPoint: state.selectedPoint || null,
          },
          null,
          2,
        ),
      );
    },
    geojson(state) {
      const features = [];
      for (const event of state.fireEvents || [])
        if (event.countryCode === (state.countryCode || C.activeCountryCode))
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [event.lon, event.lat] },
            properties: {
              kind: "FIRMS_fire_event_cluster",
              countryCode: event.countryCode,
              eventId: event.id,
              hotspotCount: event.count,
              maxFrp: event.maxFrp,
              sumFrp: event.sumFrp,
              latestDetectedAt: event.latestDetectedAt,
              earliestDetectedAt: event.earliestDetectedAt,
            },
          });
      for (const point of state.smokeData || [])
        if (Number.isFinite(point.value))
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [point.lon, point.lat] },
            properties: {
              kind: "model_sample",
              countryCode: state.countryCode || C.activeCountryCode,
              variable: point.variable,
              value: point.value,
              unit: point.unit,
              validAt: point.validAt,
              source: point.source,
              resolutionKm: point.resolutionKm,
            },
          });
      for (const a of state.fireImpacts || []) {
        if (a.event?.countryCode !== (state.countryCode || C.activeCountryCode))
          continue;
        const l = a.nearestLine || a.nearest?.line,
          e = a.evidence || null;
        if (!l) continue;
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [l.feature.a.lon, l.feature.a.lat],
              [l.feature.b.lon, l.feature.b.lat],
            ],
          },
          properties: {
            kind: "risky_line_segment",
            assetId: l.feature.assetKey || "",
            gridClass: l.feature.gridClass || "",
            eventId: a.event.id,
            riskScore: a.riskScore,
            riskLevel: a.riskBand?.level || "watch",
            evidenceCount: e?.evidenceCount ?? null,
            selectionRule: e?.selectionRule ?? null,
            triggerDetectionId: e?.triggerDetectionId ?? null,
            triggerSource: e?.triggerSource ?? null,
            triggerSatellite: e?.triggerSatellite ?? null,
            triggerInstrument: e?.triggerInstrument ?? null,
            triggerProduct: e?.triggerProduct ?? null,
            triggerDetectedAt: e?.triggerDetectedAt ?? null,
            triggerFrpMw: e?.triggerFrpMw ?? null,
            triggerConfidence: e?.triggerConfidence ?? null,
            triggerLatitude: e?.triggerLatitude ?? null,
            triggerLongitude: e?.triggerLongitude ?? null,
            triggerDistanceKm: e?.triggerDistanceKm ?? null,
            nearestLineLatitude: e?.nearestLineLatitude ?? null,
            nearestLineLongitude: e?.nearestLineLongitude ?? null,
            eventCenterLatitude: e?.eventCenterLatitude ?? null,
            eventCenterLongitude: e?.eventCenterLongitude ?? null,
          },
        });
      }
      U.download(
        `${baseName(state)}.geojson`,
        "application/geo+json",
        JSON.stringify(
          { type: "FeatureCollection", metadata: metadata(state), features },
          null,
          2,
        ),
      );
    },
  };
})(window.AtmoApp);
