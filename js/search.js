window.NexoSearch = (() => {
  const OVERPASS = "https://overpass-api.de/api/interpreter";
  const NOMINATIM = "https://nominatim.openstreetmap.org/search";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function geocode(query) {
    const url = `${NOMINATIM}?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("Não foi possível localizar esse lugar.");
    const data = await res.json();
    if (!data[0]) throw new Error("Lugar não encontrado. Tente cidade e bairro.");
    const row = data[0];
    const bbox = row.boundingbox
      ? {
          south: Number(row.boundingbox[0]),
          north: Number(row.boundingbox[1]),
          west: Number(row.boundingbox[2]),
          east: Number(row.boundingbox[3]),
        }
      : null;
    return {
      lat: Number(row.lat),
      lng: Number(row.lon),
      label: row.display_name,
      type: row.type,
      address: row.address || {},
      bbox,
    };
  }

  function cityNameFromGeo(geo, fallback) {
    const addr = geo.address || {};
    return addr.city || addr.town || addr.municipality || addr.county || fallback.split(",")[0].trim();
  }

  function formatClock(hhmm) {
    const raw = String(hhmm || "");
    if (raw.length < 3) return null;
    const padded = raw.padStart(4, "0");
    return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
  }

  function closesAtToday(periods) {
    if (!Array.isArray(periods) || !periods.length) return null;
    const day = new Date().getDay();
    const match = periods.find((p) => p.open?.day === day && p.close?.time);
    return match ? formatClock(match.close.time) : null;
  }

  function normalizeHours(openingHours, osmHours) {
    if (openingHours && (openingHours.weekday_text?.length || openingHours.periods)) {
      const weekdayText = openingHours.weekday_text || [];
      const openNow = typeof openingHours.open_now === "boolean" ? openingHours.open_now : null;
      const closesAt = closesAtToday(openingHours.periods);
      let summary = "";
      if (openNow === true) {
        summary = closesAt ? `Aberto · fecha às ${closesAt}` : "Aberto agora";
      } else if (openNow === false) {
        summary = "Fechado agora";
      } else if (weekdayText[0]) {
        summary = weekdayText[0].replace(/^[^:]+:\s*/, "");
      }
      return {
        openNow,
        closesAt,
        summary,
        weekdayText,
        raw: weekdayText.join(" | ") || summary,
      };
    }
    if (osmHours) {
      const raw = String(osmHours).trim();
      return {
        openNow: null,
        closesAt: null,
        summary: raw,
        weekdayText: [],
        raw,
      };
    }
    return null;
  }

  function estimateBbox(origin) {
    const pad = 0.12;
    return {
      south: origin.lat - pad,
      north: origin.lat + pad,
      west: origin.lng - pad,
      east: origin.lng + pad,
    };
  }

  function cityRadiusKm(bbox, origin) {
    if (!bbox) return 18;
    const center = origin || {
      lat: (bbox.south + bbox.north) / 2,
      lng: (bbox.west + bbox.east) / 2,
    };
    const corner = { lat: bbox.north, lng: bbox.east };
    const diagonal = NexoScoring.haversineKm(center, corner);
    return Math.max(diagonal || 12, 8);
  }

  async function resolveCity(place) {
    const first = await geocode(place);
    const cityName = cityNameFromGeo(first, place);
    let geo = first;

    const placeNorm = NexoData.normalize(place);
    const cityNorm = NexoData.normalize(cityName);
    const isCityLevel = first.type === "city" || first.type === "administrative" || placeNorm === cityNorm;

    if (!isCityLevel && cityName) {
      try {
        geo = await geocode(`${cityName}, Brasil`);
      } catch {
        geo = first;
      }
    }

    const bbox = geo.bbox || first.bbox || estimateBbox(geo);
    const origin = { lat: geo.lat, lng: geo.lng };

    return {
      ...origin,
      label: geo.label,
      cityName,
      bbox,
      cityRadiusKm: cityRadiusKm(bbox, origin),
    };
  }

  function mapsLink(name, address, coords) {
    if (coords?.lat) {
      return `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address || ""}`)}`;
  }

  async function searchOsm({ niche, place, radiusM }) {
    const origin = await geocode(place);
    const key = NexoData.matchKey(niche);
    const filters = NexoData.osmFilters[key] || NexoData.osmFilters.restaurante;
    const around = `(around:${radiusM},${origin.lat},${origin.lng})`;
    const clauses = filters.map((f) => `nwr${f}${around};`).join("\n");
    const query = `[out:json][timeout:25];(${clauses});out center tags;`;

    const res = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) throw new Error("A busca no mapa aberto falhou. Tente de novo em instantes.");
    const json = await res.json();
    const seen = new Set();

    const leads = (json.elements || [])
      .map((el) => {
        const tags = el.tags || {};
        const name = tags.name || tags.brand;
        if (!name) return null;
        const lat = el.lat || el.center?.lat;
        const lng = el.lon || el.center?.lon;
        const website = tags.website || tags["contact:website"] || tags.url || "";
        const phone = tags.phone || tags["contact:phone"] || tags["contact:mobile"] || "";
        const hours = normalizeHours(null, tags.opening_hours || "");
        const address = [tags["addr:street"], tags["addr:housenumber"], tags["addr:suburb"] || tags["addr:city"]]
          .filter(Boolean)
          .join(", ");
        const id = `osm-${el.type}-${el.id}`;
        if (seen.has(name + address)) return null;
        seen.add(name + address);
        return {
          id,
          name,
          category: niche,
          address: address || origin.label,
          city: tags["addr:city"] || "",
          neighborhood: tags["addr:suburb"] || "",
          rating: tags.stars ? Number(tags.stars) : null,
          reviews: null,
          phone,
          website,
          hours,
          mapsUrl: mapsLink(name, address, { lat, lng }),
          coords: lat && lng ? { lat, lng } : null,
          source: "osm",
        };
      })
      .filter(Boolean)
      .slice(0, 60);

    return { origin, leads, sourceLabel: "OpenStreetMap" };
  }

  function placesStatusMessage(status) {
    const map = {
      REQUEST_DENIED:
        "Google recusou a chave. Ative Maps JavaScript API + Places API (legada), billing, e em Credenciais use “Nenhuma” em restrição de app — ou inclua http://localhost/* se abrir por servidor local (file:// não funciona com referrer).",
      OVER_QUERY_LIMIT: "Cota da API esgotada. Aguarde ou aumente o limite no Google Cloud.",
      INVALID_REQUEST: "Pedido inválido ao Google Places. Tente outra cidade ou nicho.",
      UNKNOWN_ERROR: "Erro temporário do Google. Tente de novo em alguns segundos.",
    };
    return map[status] || `Google Places retornou: ${status || "erro desconhecido"}.`;
  }

  function loadGoogle(key) {
    return new Promise((resolve, reject) => {
      const ready = () => window.google?.maps?.places?.PlacesService;

      if (ready()) {
        resolve();
        return;
      }

      const existing = document.getElementById("google-maps-sdk");
      if (existing) {
        const currentKey = new URL(existing.src).searchParams.get("key");
        if (currentKey !== key) {
          existing.remove();
          delete window.google;
        } else {
          existing.addEventListener("load", () => {
            if (ready()) resolve();
            else reject(new Error("Maps carregou, mas Places API não está disponível. Ative Places API (legada) no Cloud Console."));
          });
          existing.addEventListener("error", () => reject(new Error("Falha ao carregar o Google Maps. Verifique a chave.")));
          return;
        }
      }

      const script = document.createElement("script");
      script.id = "google-maps-sdk";
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&language=pt-BR`;
      script.async = true;
      script.onload = () => {
        if (ready()) resolve();
        else reject(new Error("Maps carregou, mas Places API não está disponível. Ative Places API (legada) no Cloud Console."));
      };
      script.onerror = () => reject(new Error("Não foi possível carregar o SDK do Google Maps. Confira a chave e as restrições HTTP."));
      document.head.appendChild(script);
    });
  }

  function nearbyGoogle({ origin, niche, radiusM }) {
    return new Promise((resolve, reject) => {
      const node = document.createElement("div");
      const service = new google.maps.places.PlacesService(node);
      const key = NexoData.matchKey(niche);
      const type = NexoData.googleTypes[key];
      const request = {
        location: new google.maps.LatLng(origin.lat, origin.lng),
        radius: radiusM,
        keyword: niche,
      };
      if (type) request.type = type;

      service.nearbySearch(request, (results, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK && status !== google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          reject(new Error(placesStatusMessage(status)));
          return;
        }
        const leads = (results || []).map((place) => {
          const loc = place.geometry?.location;
          const coords = loc ? { lat: loc.lat(), lng: loc.lng() } : null;
          return {
            id: place.place_id,
            name: place.name,
            category: niche,
            address: place.vicinity || place.formatted_address || "",
            city: "",
            neighborhood: "",
            rating: place.rating || null,
            reviews: place.user_ratings_total || 0,
            phone: "",
            website: place.website || (place.photos ? "" : ""),
            mapsUrl: place.url || mapsLink(place.name, place.vicinity, coords),
            coords,
            hasWebsiteUnknown: !("website" in place),
            source: "google",
            placeId: place.place_id,
          };
        });
        resolve(leads);
      });
    });
  }

  function getDetails(placeId) {
    return new Promise((resolve) => {
      const node = document.createElement("div");
      const service = new google.maps.places.PlacesService(node);
      service.getDetails(
        {
          placeId,
          fields: [
            "website",
            "formatted_phone_number",
            "url",
            "rating",
            "user_ratings_total",
            "formatted_address",
            "opening_hours",
          ],
        },
        (place, status) => {
          if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
            resolve({});
            return;
          }
          resolve({
            website: place.website || "",
            phone: place.formatted_phone_number || "",
            mapsUrl: place.url,
            rating: place.rating,
            reviews: place.user_ratings_total,
            address: place.formatted_address,
            hours: normalizeHours(place.opening_hours, ""),
          });
        }
      );
    });
  }

  async function searchGoogle({ niche, place, radiusM, apiKey, onProgress }) {
    const key = String(apiKey || NexoConfig.googleApiKey || "").trim();
    if (!key) throw new Error("Chave do Google Places não configurada.");
    onProgress?.({ phase: "geocode", current: 0, total: 1, label: "Localizando endereço…" });
    await loadGoogle(key);
    const origin = await geocode(place);
    onProgress?.({ phase: "nearby", current: 1, total: 1, label: "Varrendo estabelecimentos…" });
    let leads = await nearbyGoogle({ origin, niche, radiusM });

    const slice = leads.slice(0, 18);
    const total = slice.length;
    const detailed = [];
    for (let i = 0; i < slice.length; i++) {
      const lead = slice[i];
      onProgress?.({
        phase: "details",
        current: i + 1,
        total,
        label: `Detalhes ${i + 1}/${total}`,
        detailName: lead.name,
      });
      const extra = await getDetails(lead.placeId);
      detailed.push({
        ...lead,
        website: extra.website || lead.website || "",
        phone: extra.phone || lead.phone,
        mapsUrl: extra.mapsUrl || lead.mapsUrl,
        rating: extra.rating ?? lead.rating,
        reviews: extra.reviews ?? lead.reviews,
        address: extra.address || lead.address,
        hours: extra.hours || lead.hours || null,
        hasWebsiteUnknown: false,
      });
      await sleep(120);
    }

    const rest = leads.slice(18);
    return { origin, leads: [...detailed, ...rest], sourceLabel: "Google Places" };
  }

  async function searchOne({ niche, place, radiusM, apiKey, source, onProgress }) {
    if (source === "google") {
      return searchGoogle({ niche, place, radiusM, apiKey, onProgress });
    }
    if (source === "osm") {
      onProgress?.({ phase: "osm", current: 1, total: 1, label: `OpenStreetMap: ${niche}` });
      return searchOsm({ niche, place, radiusM });
    }
    onProgress?.({ phase: "demo", current: 1, total: 1, label: `Demo: ${niche}` });
    return searchDemo({ niche, place });
  }

  async function searchBatch({ niches, place, radiusM, apiKey, source, onProgress }) {
    const list = niches.map((n) => n.trim()).filter(Boolean);
    if (!list.length) throw new Error("Informe ao menos um nicho.");

    const seen = new Set();
    const merged = [];
    let origin = null;

    for (let i = 0; i < list.length; i++) {
      const niche = list[i];
      onProgress?.({
        phase: "batch",
        current: i + 1,
        total: list.length,
        label: `Nicho ${i + 1}/${list.length}: ${niche}`,
      });
      const payload = await searchOne({
        niche,
        place,
        radiusM,
        apiKey,
        source,
        onProgress: (p) => {
          if (p.phase === "details") {
            onProgress?.({
              ...p,
              label: `${niche} — ${p.label}`,
            });
          }
        },
      });
      origin = origin || payload.origin;
      for (const lead of payload.leads) {
        const key = lead.id || `${lead.name}|${lead.address}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({ ...lead, batchNiche: niche });
      }
    }

    const labels = { google: "Google Places", osm: "OpenStreetMap", demo: "Demonstração" };
    return { origin, leads: merged, sourceLabel: labels[source] || source, batchCount: list.length };
  }

  async function searchDemo({ niche, place }) {
    await sleep(480);
    const originMap = {
      "são paulo": { lat: -23.5505, lng: -46.6333 },
      "sao paulo": { lat: -23.5505, lng: -46.6333 },
      pinheiros: { lat: -23.566, lng: -46.682 },
      "vila madalena": { lat: -23.546, lng: -46.691 },
      jardins: { lat: -23.566, lng: -46.655 },
      moema: { lat: -23.601, lng: -46.665 },
      "rio de janeiro": { lat: -22.9068, lng: -43.1729 },
      copacabana: { lat: -22.971, lng: -43.186 },
      botafogo: { lat: -22.951, lng: -43.184 },
      "belo horizonte": { lat: -19.9167, lng: -43.9345 },
      savassi: { lat: -19.937, lng: -43.936 },
    };
    const n = NexoData.normalize(place);
    const origin =
      Object.entries(originMap).find(([k]) => n.includes(k))?.[1] ||
      NexoData.searchDemo(niche, place)[0]?.coords ||
      originMap["sao paulo"];

    let leads = NexoData.searchDemo(niche, place);
    if (!leads.length) leads = NexoData.searchDemo(niche, "");
    return {
      origin,
      leads: leads.map((l) => ({ ...l, source: "demo" })),
      sourceLabel: "Demonstração",
    };
  }

  return { geocode, resolveCity, searchOsm, searchGoogle, searchDemo, searchBatch, loadGoogle };
})();
