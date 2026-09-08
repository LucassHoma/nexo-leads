window.NexoScoring = (() => {
  const defaults = {
    noSite: 35,
    stars: 25,
    reviews: 20,
    place: 15,
    phone: 5,
  };

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function haversineKm(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lng - a.lng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function reviewCurve(count) {
    const n = Number(count) || 0;
    if (n <= 0) return 0;
    return clamp(Math.log10(n + 1) / Math.log10(501), 0, 1);
  }

  function starCurve(rating) {
    const r = Number(rating);
    if (!Number.isFinite(r) || r <= 0) return 0.35;
    return clamp(r / 5, 0, 1);
  }

  function placeCurve(distanceKm, radiusKm) {
    if (distanceKm == null) return 0.55;
    const reach = Math.max(radiusKm || 2.5, 0.4);
    return clamp(1 - distanceKm / (reach * 1.15), 0, 1);
  }

  function normalizeWeights(weights) {
    const w = { ...defaults, ...weights };
    const sum = w.noSite + w.stars + w.reviews + w.place + w.phone || 1;
    return {
      noSite: w.noSite / sum,
      stars: w.stars / sum,
      reviews: w.reviews / sum,
      place: w.place / sum,
      phone: w.phone / sum,
    };
  }

  function isRealWebsite(url) {
    if (!url) return false;
    const u = String(url).toLowerCase();
    const social = ["facebook.com", "instagram.com", "wa.me", "api.whatsapp", "linktr.ee", "twitter.com", "x.com"];
    if (social.some((host) => u.includes(host))) return false;
    return /https?:\/\//i.test(url) || url.includes(".");
  }

  function phoneDigits(phone) {
    let digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
    return digits;
  }

  /** Primeiro dígito do número local (após DDD). Celular BR começa com 9. */
  function localFirstDigit(phone) {
    const digits = phoneDigits(phone);
    if (digits.length < 10) return null;
    return digits[2];
  }

  function isMobilePhone(phone) {
    return localFirstDigit(phone) === "9";
  }

  /** Fixo comercial/residencial — sem WhatsApp; não entra na listagem. */
  function isLandlinePhone(phone) {
    return localFirstDigit(phone) === "3";
  }

  function evaluate(lead, ctx = {}) {
    const weights = normalizeWeights(ctx.weights);
    const radiusKm = (ctx.radiusM || 2500) / 1000;
    const distanceKm = haversineKm(ctx.origin, lead.coords);
    const hasSite = isRealWebsite(lead.website);
    const hasPhone = isMobilePhone(lead.phone);

    const parts = {
      noSite: hasSite ? 0.12 : 1,
      stars: starCurve(lead.rating),
      reviews: reviewCurve(lead.reviews),
      place: placeCurve(distanceKm, radiusKm),
      phone: hasPhone ? 1 : 0.15,
    };

    const raw =
      parts.noSite * weights.noSite +
      parts.stars * weights.stars +
      parts.reviews * weights.reviews +
      parts.place * weights.place +
      parts.phone * weights.phone;

    const score = Math.round(clamp(raw, 0, 1) * 100);

    return {
      score,
      distanceKm,
      hasSite,
      parts: {
        noSite: Math.round(parts.noSite * 100),
        stars: Math.round(parts.stars * 100),
        reviews: Math.round(parts.reviews * 100),
        place: Math.round(parts.place * 100),
        phone: Math.round(parts.phone * 100),
      },
    };
  }

  function rank(leads, ctx) {
    const ranked = leads.map((lead) => {
      const result = evaluate(lead, ctx);
      return {
        ...lead,
        website: result.hasSite ? lead.website : "",
        score: result.score,
        distanceKm: result.distanceKm,
        breakdown: result.parts,
      };
    });

    if (ctx.prioritizeNoSite) {
      ranked.sort((a, b) => {
        if (!a.website && b.website) return -1;
        if (a.website && !b.website) return 1;
        return b.score - a.score;
      });
    } else {
      ranked.sort((a, b) => b.score - a.score);
    }
    return ranked;
  }

  return { defaults, evaluate, rank, haversineKm, isRealWebsite, isMobilePhone, isLandlinePhone };
})();
