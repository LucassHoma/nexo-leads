window.NexoApp = (() => {
  const STORAGE_SAVED = "nexo-saved-leads";
  const STORAGE_SETTINGS = "nexo-settings";
  const STORAGE_SIDEBAR = "nexo-sidebar-collapsed";
  const PAGE_SIZE = 50;

  const els = {
    form: document.getElementById("search-form"),
    results: document.getElementById("results"),
    pagination: document.getElementById("pagination"),
    kanban: document.getElementById("kanban-board"),
    savedCount: document.getElementById("saved-count"),
    meta: document.getElementById("results-meta"),
    banner: document.getElementById("status-banner"),
    exportBtn: document.getElementById("export-btn"),
    searchBtn: document.getElementById("search-btn"),
    sourcePill: document.getElementById("source-pill-text"),
    toast: document.getElementById("toast"),
    drawer: document.getElementById("drawer"),
    modal: document.getElementById("settings-modal"),
    googleKey: document.getElementById("google-key"),
    viewTitle: document.getElementById("view-title"),
    progressWrap: document.getElementById("search-progress"),
    progressLabel: document.getElementById("progress-label"),
    progressDetail: document.getElementById("progress-detail"),
    progressBar: document.getElementById("progress-bar"),
    progressSub: document.getElementById("progress-sub"),
  };

  const titles = {
    search: "Radar de estabelecimentos",
    saved: "Pipeline de outreach",
    criteria: "Critérios de avaliação",
  };

  let currentLeads = [];
  let lastCtx = null;
  let lastCityName = "";
  let lastBatchCount = 0;
  let lastSearchPlace = "";
  let saved = loadSaved();
  let settings = loadSettings();
  let toastTimer = null;
  let currentPage = 1;
  let filteredLeads = [];

  function loadSaved() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_SAVED) || "[]");
      return list.map((item) => ({
        ...item,
        pipelineStatus: NexoPipeline.normalizeStatus(item.pipelineStatus),
      }));
    } catch {
      return [];
    }
  }

  function loadSettings() {
    const defaults = {
      source: NexoConfig.defaultSource,
      googleKey: "",
    };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_SETTINGS) || "{}");
      return {
        ...defaults,
        ...saved,
        googleKey: String(saved.googleKey || "").trim(),
        source: saved.source || defaults.source,
      };
    } catch {
      return { ...defaults };
    }
  }

  function persistSaved() {
    localStorage.setItem(STORAGE_SAVED, JSON.stringify(saved));
    els.savedCount.textContent = String(saved.length);
  }

  function persistSettings() {
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
  }

  function weights() {
    return {
      noSite: Number(document.getElementById("w-site").value),
      stars: Number(document.getElementById("w-stars").value),
      reviews: Number(document.getElementById("w-reviews").value),
      place: Number(document.getElementById("w-place").value),
      phone: Number(document.getElementById("w-phone").value),
    };
  }

  function syncWeightLabels() {
    document.getElementById("w-site-val").textContent = document.getElementById("w-site").value;
    document.getElementById("w-stars-val").textContent = document.getElementById("w-stars").value;
    document.getElementById("w-reviews-val").textContent = document.getElementById("w-reviews").value;
    document.getElementById("w-place-val").textContent = document.getElementById("w-place").value;
    document.getElementById("w-phone-val").textContent = document.getElementById("w-phone").value;
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2400);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatStars(rating) {
    if (rating == null || Number.isNaN(Number(rating))) return "Sem nota";
    return `${Number(rating).toFixed(1)} ★`;
  }

  function formatReviews(count) {
    if (count == null) return "avaliações indisponíveis";
    return `${count} avaliações`;
  }

  function formatDistance(km) {
    if (km == null) return "";
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(1)} km`;
  }

  function isSaved(id) {
    return saved.some((item) => item.id === id);
  }

  function applyFilters(leads) {
    const hideSite = document.getElementById("f-hide-site").checked;
    const minStars = Number(document.getElementById("f-stars").value);
    const minReviews = Number(document.getElementById("f-reviews").value);
    const openFilter = document.getElementById("f-open")?.value || "all";
    const sort = document.getElementById("f-sort").value;

    let list = leads.filter((lead) => {
      if (lead.phone && NexoScoring.isLandlinePhone(lead.phone)) return false;
      if (hideSite && lead.website) return false;

      if (minStars > 0) {
        if (lead.rating == null) {
          if (lead.source !== "osm") return false;
        } else if (lead.rating < minStars) {
          return false;
        }
      }

      if (minReviews > 0) {
        if (lead.reviews == null) {
          if (lead.source !== "osm") return false;
        } else if (lead.reviews < minReviews) {
          return false;
        }
      }

      if (openFilter === "open" && lead.hours?.openNow !== true) return false;
      if (openFilter === "closed" && lead.hours?.openNow !== false) return false;

      return true;
    });

    const sorters = {
      score: (a, b) => b.score - a.score,
      stars: (a, b) => (b.rating || 0) - (a.rating || 0),
      reviews: (a, b) => (b.reviews || 0) - (a.reviews || 0),
      distance: (a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99),
      open: (a, b) => {
        const ao = a.hours?.openNow === true ? 0 : a.hours?.openNow === false ? 2 : 1;
        const bo = b.hours?.openNow === true ? 0 : b.hours?.openNow === false ? 2 : 1;
        if (ao !== bo) return ao - bo;
        return b.score - a.score;
      },
    };
    list.sort(sorters[sort] || sorters.score);
    return list;
  }

  function formatHours(hours) {
    if (!hours) return "";
    if (isClosingSoon(hours) && hours.closesAt) {
      return `Fecha em breve · às ${hours.closesAt}`;
    }
    if (hours.summary) return hours.summary;
    if (hours.closesAt) return `Fecha às ${hours.closesAt}`;
    return hours.raw || "";
  }

  function minutesUntilClose(closesAt) {
    if (!closesAt) return null;
    const parts = String(closesAt).split(":");
    const h = Number(parts[0]);
    const m = Number(parts[1] || 0);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    const now = new Date();
    const close = new Date(now);
    close.setHours(h, m, 0, 0);
    const diff = Math.round((close - now) / 60000);
    return diff;
  }

  function isClosingSoon(hours) {
    if (!hours || hours.openNow !== true || !hours.closesAt) return false;
    const mins = minutesUntilClose(hours.closesAt);
    return mins != null && mins >= 0 && mins <= 60;
  }

  function hoursBadge(hours) {
    const label = formatHours(hours);
    if (!label) return "";
    const tip = escapeHtml(hours.raw || label);
    if (isClosingSoon(hours)) {
      return `<span class="badge warn" title="${tip}">${escapeHtml(label)}</span>`;
    }
    if (hours.openNow === true) {
      return `<span class="badge ok" title="${tip}">${escapeHtml(label)}</span>`;
    }
    if (hours.openNow === false) {
      return `<span class="badge hot" title="${tip}">${escapeHtml(label)}</span>`;
    }
    return `<span class="badge" title="${tip}"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escapeHtml(label)}</span>`;
  }

  function categoryIcon(category) {
    const c = String(category || "").toLowerCase();
    if (c.includes("barbear")) return "fa-solid fa-scissors";
    if (c.includes("restaur") || c.includes("pizza")) return "fa-solid fa-utensils";
    if (c.includes("café") || c.includes("cafe")) return "fa-solid fa-mug-hot";
    if (c.includes("salão") || c.includes("beleza") || c.includes("estética")) return "fa-solid fa-spa";
    if (c.includes("academia") || c.includes("fitness")) return "fa-solid fa-dumbbell";
    if (c.includes("oficina") || c.includes("mecân")) return "fa-solid fa-wrench";
    if (c.includes("odonto") || c.includes("clínica") || c.includes("médic")) return "fa-solid fa-stethoscope";
    if (c.includes("pet")) return "fa-solid fa-paw";
    if (c.includes("farmac")) return "fa-solid fa-pills";
    if (c.includes("imobili")) return "fa-solid fa-building";
    if (c.includes("advog")) return "fa-solid fa-scale-balanced";
    if (c.includes("mercado")) return "fa-solid fa-cart-shopping";
    return "fa-solid fa-store";
  }

  function leadPhotoUrl(lead) {
    if (lead.photoUrl) return lead.photoUrl;
    return NexoSearch.buildPhotoUrl(lead.photoRef, settings.googleKey);
  }

  function scoreTone(score) {
    const s = Number(score) || 0;
    if (s >= 85) return "hot";
    if (s >= 70) return "high";
    if (s >= 55) return "mid";
    if (s >= 40) return "low";
    return "cold";
  }

  function leadMediaHtml(lead) {
    const url = leadPhotoUrl(lead);
    const icon = categoryIcon(lead.category);
    const placeholder = `
      <div class="lead-card-placeholder" aria-hidden="true">
        <i class="${icon}"></i>
        <span>${escapeHtml(lead.category)}</span>
      </div>
    `;
    if (!url) return placeholder;
    return `
      ${placeholder}
      <img
        class="lead-card-img"
        src="${escapeHtml(url)}"
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        onerror="this.remove()"
      />
    `;
  }

  function card(lead, index = 0) {
    const dist = formatDistance(lead.distanceKm);
    const savedOn = isSaved(lead.id);
    const hot = !lead.website;
    const openFlag =
      lead.hours?.openNow === true
        ? '<span class="lead-card-flag open">Aberto</span>'
        : hot
          ? '<span class="lead-card-flag hot">Sem site</span>'
          : "";
    return `
      <article class="lead lead-card" data-id="${escapeHtml(lead.id)}" tabindex="0" style="--i:${index}">
        <div class="lead-card-media">
          ${leadMediaHtml(lead)}
          <div class="lead-card-media-overlay"></div>
          ${openFlag}
          <div class="lead-card-score score-${scoreTone(lead.score)}" title="Score ${lead.score}">
            <span>${lead.score}</span>
          </div>
          ${dist ? `<span class="lead-card-dist"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> ${dist}</span>` : ""}
        </div>
        <div class="lead-card-body">
          <div class="lead-card-head">
            <h3>${escapeHtml(lead.name)}</h3>
            <p class="lead-card-rating">
              <span class="stars">${formatStars(lead.rating)}</span>
              <span class="lead-card-reviews">${formatReviews(lead.reviews)}</span>
            </p>
          </div>
          <p class="lead-card-address">${escapeHtml(lead.address)}</p>
          <div class="badges lead-card-badges">
            ${lead.website ? '<span class="badge">Tem site</span>' : '<span class="badge hot">Sem site</span>'}
            <span class="badge">${escapeHtml(lead.category)}</span>
            ${NexoScoring.isMobilePhone(lead.phone) ? '<span class="badge ok"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i> Celular</span>' : ""}
            ${hoursBadge(lead.hours)}
          </div>
          <div class="lead-card-foot">
            <button class="tiny ${savedOn ? "is-on" : ""}" data-act="save" type="button">
              <i class="fa-solid ${savedOn ? "fa-check" : "fa-plus"}" aria-hidden="true"></i>
              ${savedOn ? "No pipeline" : "Pipeline"}
            </button>
            <a class="tiny" href="${escapeHtml(lead.mapsUrl)}" target="_blank" rel="noopener">
              <i class="fa-solid fa-map-location-dot" aria-hidden="true"></i>
              Maps
            </a>
          </div>
        </div>
      </article>
    `;
  }

  function skeletonCards(count = 6) {
    return Array.from({ length: count }, () => `<div class="lead-card lead-card--skeleton skeleton" aria-hidden="true"></div>`).join("");
  }

  function paginateLeads(leads) {
    const total = leads.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, total);
    return {
      total,
      totalPages,
      startIdx,
      endIdx,
      page: leads.slice(startIdx, endIdx),
    };
  }

  function paginationPages(totalPages, page) {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = new Set([1, totalPages, page, page - 1, page + 1]);
    const list = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (i > 0 && list[i] - list[i - 1] > 1) out.push("…");
      out.push(list[i]);
    }
    return out;
  }

  function renderPagination(pag) {
    if (!els.pagination) return;
    if (!pag || pag.total <= PAGE_SIZE) {
      els.pagination.hidden = true;
      els.pagination.innerHTML = "";
      return;
    }
    els.pagination.hidden = false;
    const pages = paginationPages(pag.totalPages, currentPage);
    els.pagination.innerHTML = `
      <button class="pagination-btn" type="button" data-page="prev" ${currentPage <= 1 ? "disabled" : ""}>
        <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
        Anterior
      </button>
      <div class="pagination-center">
        <span class="pagination-range">Mostrando ${pag.startIdx + 1}–${pag.endIdx} de ${pag.total}</span>
        <div class="pagination-pages" role="group" aria-label="Páginas">
          ${pages
            .map((p) =>
              p === "…"
                ? `<span class="pagination-ellipsis">…</span>`
                : `<button class="pagination-page ${p === currentPage ? "is-active" : ""}" type="button" data-page="${p}">${p}</button>`
            )
            .join("")}
        </div>
      </div>
      <button class="pagination-btn" type="button" data-page="next" ${currentPage >= pag.totalPages ? "disabled" : ""}>
        Próxima
        <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
      </button>
    `;
  }

  function emptyStateHtml(title, text) {
    return `
      <div class="empty">
        <div class="empty-icon" aria-hidden="true">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="18" stroke="currentColor" stroke-width="2" opacity="0.35" />
            <circle cx="20" cy="20" r="12" stroke="currentColor" stroke-width="2.2" />
            <circle cx="20" cy="20" r="6" stroke="currentColor" stroke-width="2.2" />
            <circle cx="20" cy="20" r="2.4" fill="currentColor" />
          </svg>
        </div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(text)}</p>
      </div>
    `;
  }

  function renderList(target, leads, emptyText) {
    filteredLeads = leads;
    if (!leads.length) {
      target.innerHTML = emptyStateHtml("Nada por aqui", emptyText);
      renderPagination(null);
      return;
    }
    const pag = paginateLeads(leads);
    target.innerHTML = pag.page.map((lead, i) => card(lead, i)).join("");
    renderPagination(pag);
  }

  function goToPage(page) {
    if (page === "prev") currentPage -= 1;
    else if (page === "next") currentPage += 1;
    else currentPage = Number(page);
    renderList(els.results, filteredLeads, "Ajuste nicho, lugar ou filtros.");
    els.meta.textContent = resultsMeta(filteredLeads);
    const scrollBtn = document.getElementById("scroll-top-btn");
    if (scrollBtn) scrollBtn.hidden = filteredLeads.length < 6;
    document.querySelector(".results-head")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resultsMeta(leads) {
    const count = leads.length;
    if (!count) return "Defina nicho e lugar para varrer o mapa.";
    const city = lastCityName ? ` em ${lastCityName}` : "";
    const batch = lastBatchCount > 1 ? ` · ${lastBatchCount} nichos` : "";
    const open = leads.filter((l) => l.hours?.openNow === true).length;
    const closed = leads.filter((l) => l.hours?.openNow === false).length;
    const noSite = leads.filter((l) => !l.website).length;
    const bits = [`${count} lead${count > 1 ? "s" : ""}`, city.trim(), batch.trim()].filter(Boolean);
    let line = bits.join(" ").replace(/\s+/g, " ").trim();
    if (!line.endsWith(".")) line += ".";
    const extras = [];
    if (noSite) extras.push(`${noSite} sem site`);
    if (open) extras.push(`${open} aberto${open > 1 ? "s" : ""}`);
    if (closed) extras.push(`${closed} fechado${closed > 1 ? "s" : ""}`);
    if (extras.length) line += ` · ${extras.join(" · ")}`;
    return line;
  }

  function parseNiches() {
    const batchOn = document.getElementById("f-batch").checked;
    if (!batchOn) {
      return [document.getElementById("q-niche").value.trim()].filter(Boolean);
    }
    const fromInput = document.getElementById("q-niche").value
      .split(/[,;|]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const fromPicks = [...document.querySelectorAll("#batch-picks .chip.is-active")].map(
      (el) => el.dataset.batchNiche
    );
    return [...new Set([...fromPicks, ...fromInput])];
  }

  function setProgress(data) {
    if (!data) {
      els.progressWrap.hidden = true;
      return;
    }
    els.progressWrap.hidden = false;
    els.progressLabel.textContent = data.label || "Buscando…";
    const pct = data.total ? Math.round((data.current / data.total) * 100) : 0;
    els.progressBar.style.width = `${pct}%`;
    els.progressDetail.textContent = data.total ? `${data.current}/${data.total}` : "";
    els.progressSub.textContent = data.detailName || "";
  }

  function renderCurrent(resetPage = false) {
    if (resetPage) currentPage = 1;
    const visible = applyFilters(currentLeads);
    renderList(
      els.results,
      visible,
      "Ajuste nicho, lugar ou filtros. No modo demo, tente barbearia em São Paulo."
    );
    els.exportBtn.disabled = visible.length === 0;
    els.meta.textContent = resultsMeta(visible);
    const scrollBtn = document.getElementById("scroll-top-btn");
    if (scrollBtn) scrollBtn.hidden = visible.length < 6;
  }

  function resetFilters() {
    document.getElementById("f-nosite").checked = true;
    document.getElementById("f-hide-site").checked = true;
    document.getElementById("f-open").value = "all";
    document.getElementById("f-stars").value = "4";
    document.getElementById("f-reviews").value = "30";
    document.getElementById("f-sort").value = "score";
    document.getElementById("f-batch").checked = false;
    syncBatchUi();
    if (currentLeads.length) {
      lastCtx = {
        ...(lastCtx || {}),
        weights: weights(),
        prioritizeNoSite: true,
      };
      currentLeads = NexoScoring.rank(currentLeads, lastCtx);
    }
    renderCurrent(true);
    toast("Filtros restaurados");
  }

  function renderKanban() {
    NexoPipeline.render(els.kanban, saved, escapeHtml);
  }

  function renderSaved() {
    renderKanban();
  }

  function setPipelineStatus(id, status) {
    const lead = saved.find((l) => l.id === id);
    if (!lead) return;
    lead.pipelineStatus = NexoPipeline.normalizeStatus(status);
    persistSaved();
    renderKanban();
  }

  function outreachActions(lead, message) {
    const links = NexoMessages.whatsappLinks(lead, message);
    return links
      ? `<a class="primary wa-open" href="${escapeHtml(links.app)}" data-web="${escapeHtml(links.web)}">WhatsApp</a>`
      : `<span class="fine">Sem telefone para WhatsApp.</span>`;
  }

  function showOutreach(lead) {
    const box = document.getElementById("drawer-outreach");
    const msgs = NexoMessages.compose(lead, { place: lastSearchPlace || lastCityName });
    document.getElementById("outreach-approach").value = msgs.approach;
    document.getElementById("outreach-question").value = msgs.question;
    document.getElementById("outreach-proposal").value = msgs.proposal;
    document.getElementById("outreach-approach-actions").innerHTML = outreachActions(lead, msgs.approach);
    document.getElementById("outreach-question-actions").innerHTML = outreachActions(lead, msgs.question);
    document.getElementById("outreach-proposal-actions").innerHTML = outreachActions(lead, msgs.proposal);
    box.hidden = false;
  }

  function openDrawer(lead) {
    document.getElementById("drawer-cat").textContent = lead.category;
    document.getElementById("drawer-title").textContent = lead.name;
    document.getElementById("drawer-score").textContent = `${lead.score} pts`;
    document.getElementById("drawer-score").className = `drawer-score score-${scoreTone(lead.score)}`;
    document.getElementById("drawer-meta").innerHTML = `
      <div><dt>Endereço</dt><dd>${escapeHtml(lead.address)}</dd></div>
      <div><dt>Estrelas</dt><dd>${formatStars(lead.rating)}</dd></div>
      <div><dt>Avaliações</dt><dd>${formatReviews(lead.reviews)}</dd></div>
      <div><dt>Site</dt><dd>${lead.website ? escapeHtml(lead.website) : "Não encontrado"}</dd></div>
      <div><dt>Telefone</dt><dd>${
        NexoScoring.isMobilePhone(lead.phone)
          ? escapeHtml(lead.phone)
          : lead.phone
            ? `${escapeHtml(lead.phone)} (fixo — sem WhatsApp)`
            : "Não informado"
      }</dd></div>
      <div><dt>Horário</dt><dd class="${isClosingSoon(lead.hours) ? "hours-warn" : ""}">${
        lead.hours
          ? escapeHtml(formatHours(lead.hours) || lead.hours.raw || "—")
          : "Não informado"
      }</dd></div>
      ${
        lead.hours?.weekdayText?.length
          ? `<div class="hours-week"><dt>Semana</dt><dd>${lead.hours.weekdayText
              .map((line) => `<span>${escapeHtml(line)}</span>`)
              .join("")}</dd></div>`
          : ""
      }
      <div><dt>Distância</dt><dd>${formatDistance(lead.distanceKm) || "—"}</dd></div>
    `;
    const b = lead.breakdown || {};
    document.getElementById("drawer-breakdown").innerHTML = [
      ["Sem site", b.noSite],
      ["Estrelas", b.stars],
      ["Avaliações", b.reviews],
      ["Lugar", b.place],
      ["Telefone", b.phone],
    ]
      .map(
        ([label, val]) =>
          `<div class="bar"><span>${label}</span><i><em style="width:${val || 0}%"></em></i><b>${val || 0}</b></div>`
      )
      .join("");
    const savedOn = isSaved(lead.id);
    document.getElementById("drawer-actions").innerHTML = `
      <button class="primary" data-drawer-save type="button">${savedOn ? "Remover do pipeline" : "Adicionar ao pipeline"}</button>
      <a class="ghost" href="${escapeHtml(lead.mapsUrl)}" target="_blank" rel="noopener">Abrir no Maps</a>
      ${NexoScoring.isMobilePhone(lead.phone) ? `<button class="ghost" data-copy-phone type="button">Copiar telefone</button>` : ""}
    `;
    document.getElementById("drawer-actions").dataset.id = lead.id;
    showOutreach(lead);
    els.drawer.hidden = false;
  }

  function closeDrawer() {
    els.drawer.hidden = true;
    document.getElementById("drawer-outreach").hidden = true;
  }

  function openSettings() {
    document.querySelectorAll('input[name="source"]').forEach((radio) => {
      radio.checked = radio.value === (settings.source || NexoConfig.defaultSource);
    });
    els.googleKey.value = settings.googleKey || "";
    els.modal.hidden = false;
  }

  function closeSettings() {
    els.modal.hidden = true;
  }

  function findLead(id) {
    return currentLeads.find((l) => l.id === id) || saved.find((l) => l.id === id);
  }

  function toggleSave(id) {
    const lead = findLead(id);
    if (!lead) return;
    if (isSaved(id)) {
      saved = saved.filter((item) => item.id !== id);
      toast("Removido dos salvos");
    } else {
      saved = [
        {
          ...lead,
          pipelineStatus: "queue",
          savedAt: Date.now(),
        },
        ...saved.filter((item) => item.id !== id),
      ];
      toast("Lead adicionado à fila do pipeline");
    }
    persistSaved();
    renderCurrent();
    renderKanban();
  }

  function exportCsv() {
    const rows = applyFilters(currentLeads);
    const header = ["Nome", "Categoria", "Score", "Estrelas", "Avaliações", "Endereço", "Telefone", "Horário", "Site", "Maps"];
    const lines = [
      header.join(";"),
      ...rows.map((l) =>
        [
          l.name,
          l.category,
          l.score,
          l.rating ?? "",
          l.reviews ?? "",
          l.address,
          l.phone,
          l.hours?.raw || l.hours?.summary || "",
          l.website,
          l.mapsUrl,
        ]
          .map((v) => `"${String(v).replaceAll('"', '""')}"`)
          .join(";")
      ),
    ];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nexo-leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function showBanner(text, show) {
    els.banner.hidden = !show;
    els.banner.textContent = text || "";
  }

  function sourceLabel() {
    const map = {
      demo: "Modo demonstração",
      osm: "OpenStreetMap",
      google: "Google Places",
    };
    return map[settings.source || NexoConfig.defaultSource];
  }

  function setSearchLoading(on) {
    els.searchBtn.disabled = on;
    els.searchBtn.classList.toggle("is-loading", on);
    const label = els.searchBtn.querySelector(".btn-label");
    if (label) label.textContent = on ? "Buscando…" : "Buscar leads";
  }

  async function runSearch(event) {
    event.preventDefault();
    const niches = parseNiches();
    if (!niches.length) {
      toast("Informe ao menos um nicho");
      return;
    }
    const place = document.getElementById("q-place").value.trim();
    const radiusM = Number(document.getElementById("q-radius").value);
    const source = settings.source || NexoConfig.defaultSource;
    const apiKey = settings.googleKey || "";
    if (source === "google" && !apiKey) {
      toast("Configure a chave do Google em Fonte de dados");
      openSettings();
      return;
    }
    const batchOn = document.getElementById("f-batch").checked;
    lastSearchPlace = place;

    setSearchLoading(true);
    currentPage = 1;
    els.results.innerHTML = skeletonCards(8);
    showBanner("", false);
    setProgress({ phase: "start", current: 0, total: 1, label: "Iniciando busca…" });

    const onProgress = (p) => setProgress(p);

    try {
      let payload;
      if (batchOn && niches.length > 1) {
        payload = await NexoSearch.searchBatch({ niches, place, radiusM, apiKey, source, onProgress });
        lastBatchCount = payload.batchCount || niches.length;
      } else {
        lastBatchCount = 0;
        const niche = niches[0];
        if (source === "google") payload = await NexoSearch.searchGoogle({ niche, place, radiusM, apiKey, onProgress });
        else if (source === "osm") {
          setProgress({ phase: "osm", current: 1, total: 1, label: "Varrendo OpenStreetMap…" });
          payload = await NexoSearch.searchOsm({ niche, place, radiusM });
        } else {
          setProgress({ phase: "demo", current: 1, total: 1, label: "Carregando demonstração…" });
          payload = await NexoSearch.searchDemo({ niche, place });
        }
      }

      lastCityName = place.split(",")[0].trim();
      lastCtx = {
        weights: weights(),
        radiusM,
        origin: payload.origin,
        prioritizeNoSite: document.getElementById("f-nosite").checked,
      };
      currentLeads = NexoScoring.rank(payload.leads, lastCtx);

      if (source === "osm") {
        showBanner(
          "OpenStreetMap não replica estrelas e volume de reviews do Google. O score pesa mais site, telefone e proximidade.",
          true
        );
      } else if (source === "demo") {
        showBanner("Demonstração com estabelecimentos de exemplo. Troque a fonte de dados para buscar ao vivo.", true);
      } else if (batchOn && niches.length > 1) {
        showBanner(`Lote concluído: ${niches.length} nichos varridos em ${lastCityName}.`, true);
      }

      els.sourcePill.textContent = payload.sourceLabel;
      NexoSuggesters.rememberSearch(niches.join(", "), place);
      renderCurrent();
      document.querySelector(".main")?.scrollTo({ top: 0, behavior: "smooth" });
      if (!currentLeads.length) toast("Nenhum estabelecimento encontrado nesse recorte.");
      else toast(`${applyFilters(currentLeads).length} leads na mira`);
    } catch (err) {
      currentLeads = [];
      renderCurrent();
      showBanner(err.message || "Falha na busca.", true);
    } finally {
      setSearchLoading(false);
      setProgress(null);
    }
  }

  function switchView(name) {
    document.querySelectorAll(".view").forEach((view) => {
      const on = view.id === `view-${name}`;
      view.hidden = !on;
      view.classList.toggle("is-visible", on);
    });
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.view === name);
    });
    els.viewTitle.textContent = titles[name];
    if (name === "saved") renderKanban();
    if (isMobileLayout() && !document.getElementById("app").classList.contains("is-sidebar-collapsed")) {
      setSidebarCollapsed(true);
    }
  }

  function isMobileLayout() {
    return window.matchMedia("(max-width: 980px)").matches;
  }

  function setSidebarCollapsed(collapsed) {
    const app = document.getElementById("app");
    const toggle = document.getElementById("sidebar-toggle");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (!app || !toggle) return;
    app.classList.toggle("is-sidebar-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Expandir menu" : "Recolher menu");
    if (backdrop) {
      backdrop.hidden = collapsed || !isMobileLayout();
    }
    localStorage.setItem(STORAGE_SIDEBAR, collapsed ? "1" : "0");
  }

  function initSidebar() {
    const saved = localStorage.getItem(STORAGE_SIDEBAR);
    const collapsed = saved == null ? isMobileLayout() : saved === "1";
    setSidebarCollapsed(collapsed);

    document.getElementById("sidebar-toggle")?.addEventListener("click", () => {
      const app = document.getElementById("app");
      setSidebarCollapsed(!app.classList.contains("is-sidebar-collapsed"));
    });
    document.getElementById("sidebar-backdrop")?.addEventListener("click", () => {
      setSidebarCollapsed(true);
    });
    window.matchMedia("(max-width: 980px)").addEventListener("change", (event) => {
      if (event.matches) setSidebarCollapsed(true);
      else {
        const backdrop = document.getElementById("sidebar-backdrop");
        if (backdrop) backdrop.hidden = true;
      }
    });
  }

  function syncBatchUi() {
    const on = document.getElementById("f-batch").checked;
    const batchWrap = document.getElementById("batch-chips-wrap");
    const singleWrap = document.getElementById("single-chips-wrap");
    if (batchWrap) batchWrap.hidden = !on;
    if (singleWrap) singleWrap.hidden = on;
    document.getElementById("niche-hint").textContent = on
      ? "— selecione abaixo ou separe por vírgula"
      : "";
    document.getElementById("q-niche").placeholder = on
      ? "Ex.: Barbearia, Restaurante, Academia"
      : "Ex.: barbearia, clínica, oficina";

    if (on) {
      document.querySelectorAll("#niche-chips .chip.is-active").forEach((el) => el.classList.remove("is-active"));
    } else {
      document.querySelectorAll("#batch-picks .chip.is-active").forEach((el) => el.classList.remove("is-active"));
      const value = NexoData.normalize(document.getElementById("q-niche").value);
      document.querySelectorAll("#niche-chips .chip").forEach((el) => {
        el.classList.toggle("is-active", NexoData.normalize(el.dataset.niche) === value);
      });
    }
  }

  function bindKanban() {
    let dragId = null;

    els.kanban.addEventListener("dragstart", (event) => {
      const card = event.target.closest(".kanban-card");
      if (!card) return;
      dragId = card.dataset.id;
      card.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
    });

    els.kanban.addEventListener("dragend", (event) => {
      event.target.closest(".kanban-card")?.classList.remove("is-dragging");
      dragId = null;
    });

    els.kanban.addEventListener("dragover", (event) => {
      if (!event.target.closest(".kanban-drop")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });

    els.kanban.addEventListener("drop", (event) => {
      const drop = event.target.closest(".kanban-drop");
      if (!drop || !dragId) return;
      event.preventDefault();
      setPipelineStatus(dragId, drop.dataset.drop);
    });

    els.kanban.addEventListener("click", (event) => {
      const card = event.target.closest(".kanban-card");
      if (!card) return;
      const id = card.dataset.id;
      const lead = findLead(id);
      if (!lead) return;

      const moveBtn = event.target.closest("[data-kanban-move]");
      if (moveBtn) {
        setPipelineStatus(id, moveBtn.dataset.kanbanMove);
        return;
      }
      if (event.target.closest("[data-kanban-open]")) {
        openDrawer(lead);
        return;
      }
      if (event.target.closest("[data-kanban-msg]")) {
        openDrawer(lead);
        document.getElementById("outreach-approach").focus();
      }
    });
  }

  function bind() {
    els.form.addEventListener("submit", runSearch);
    document.getElementById("reset-filters")?.addEventListener("click", resetFilters);
    document.getElementById("scroll-top-btn")?.addEventListener("click", () => {
      document.querySelector(".main")?.scrollTo({ top: 0, behavior: "smooth" });
    });
    document.getElementById("niche-chips").addEventListener("click", (event) => {
      const chip = event.target.closest("[data-niche]");
      if (!chip) return;
      document.getElementById("q-niche").value = chip.dataset.niche;
      document.querySelectorAll("#niche-chips .chip").forEach((el) => el.classList.toggle("is-active", el === chip));
    });
    document.getElementById("q-niche").addEventListener("input", () => {
      const value = NexoData.normalize(document.getElementById("q-niche").value);
      document.querySelectorAll("#niche-chips .chip").forEach((el) => {
        el.classList.toggle("is-active", NexoData.normalize(el.dataset.niche) === value);
      });
    });
    document.getElementById("f-batch").addEventListener("change", syncBatchUi);
    document.getElementById("batch-picks").addEventListener("click", (event) => {
      const chip = event.target.closest("[data-batch-niche]");
      if (!chip) return;
      chip.classList.toggle("is-active");
    });
    syncBatchUi();
    bindKanban();
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    ["w-site", "w-stars", "w-reviews", "w-place", "w-phone"].forEach((id) => {
      document.getElementById(id).addEventListener("input", () => {
        syncWeightLabels();
        if (currentLeads.length) {
          lastCtx = {
            ...(lastCtx || {}),
            weights: weights(),
            radiusM: Number(document.getElementById("q-radius").value),
            origin: lastCtx?.origin || currentLeads[0].coords,
            prioritizeNoSite: document.getElementById("f-nosite").checked,
          };
          currentLeads = NexoScoring.rank(currentLeads, lastCtx);
          renderCurrent();
        }
      });
    });
    ["f-hide-site", "f-stars", "f-reviews", "f-sort", "f-open"].forEach((id) => {
      document.getElementById(id).addEventListener("change", () => renderCurrent(true));
    });
    document.getElementById("f-nosite").addEventListener("change", () => {
      if (!currentLeads.length) return;
      lastCtx = {
        ...(lastCtx || {}),
        weights: weights(),
        prioritizeNoSite: document.getElementById("f-nosite").checked,
      };
      currentLeads = NexoScoring.rank(currentLeads, lastCtx);
      renderCurrent(true);
    });
    els.pagination?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-page]");
      if (!btn || btn.disabled) return;
      event.preventDefault();
      goToPage(btn.dataset.page);
    });
    els.exportBtn.addEventListener("click", exportCsv);
    document.getElementById("clear-saved").addEventListener("click", () => {
      saved = [];
      persistSaved();
      renderKanban();
      renderCurrent();
    });

    els.results.addEventListener("click", onLeadClick);

    document.getElementById("copy-approach").addEventListener("click", () => {
      navigator.clipboard.writeText(document.getElementById("outreach-approach").value);
      toast("Abordagem copiada");
    });
    document.getElementById("copy-question").addEventListener("click", () => {
      navigator.clipboard.writeText(document.getElementById("outreach-question").value);
      toast("Pergunta copiada");
    });
    document.getElementById("copy-proposal").addEventListener("click", () => {
      navigator.clipboard.writeText(document.getElementById("outreach-proposal").value);
      toast("Proposta copiada");
    });

    document.getElementById("drawer-close").addEventListener("click", closeDrawer);
    els.drawer.addEventListener("click", (event) => {
      if (event.target === els.drawer) closeDrawer();

      const waLink = event.target.closest(".wa-open");
      if (waLink) {
        event.preventDefault();
        window.location.assign(waLink.getAttribute("href"));
        const web = waLink.dataset.web;
        const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);
        if (web && !isMobile) {
          setTimeout(() => {
            if (document.visibilityState === "visible") {
              window.open(web, "_blank", "noopener");
            }
          }, 1500);
        }
        return;
      }

      const id = document.getElementById("drawer-actions").dataset.id;
      if (event.target.matches("[data-drawer-save]")) toggleSave(id);
      if (event.target.matches("[data-copy-phone]")) {
        const lead = findLead(id);
        if (lead?.phone && NexoScoring.isMobilePhone(lead.phone)) {
          navigator.clipboard.writeText(lead.phone);
          toast("Telefone copiado");
        }
      }
    });

    document.getElementById("open-settings").addEventListener("click", openSettings);
    document.getElementById("settings-close").addEventListener("click", closeSettings);
    els.modal.addEventListener("click", (event) => {
      if (event.target === els.modal) closeSettings();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeDrawer();
      closeSettings();
      if (isMobileLayout()) setSidebarCollapsed(true);
    });

    els.results.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const cardEl = event.target.closest(".lead");
      if (cardEl) {
        const lead = findLead(cardEl.dataset.id);
        if (lead) openDrawer(lead);
      }
    });

    document.getElementById("save-settings").addEventListener("click", () => {
      settings.source = document.querySelector('input[name="source"]:checked').value;
      settings.googleKey = els.googleKey.value.trim();
      if (settings.source === "google" && !settings.googleKey) {
        toast("Cole a chave do Google Places para usar essa fonte");
        return;
      }
      persistSettings();
      els.sourcePill.textContent = sourceLabel();
      closeSettings();
      toast("Fonte de dados atualizada");
    });
  }

  function onLeadClick(event) {
    const saveBtn = event.target.closest("[data-act='save']");
    const cardEl = event.target.closest(".lead");
    if (!cardEl) return;
    if (event.target.closest("a")) return;
    if (saveBtn) {
      event.stopPropagation();
      toggleSave(cardEl.dataset.id);
      return;
    }
    const lead = findLead(cardEl.dataset.id);
    if (lead) openDrawer(lead);
  }

  function init() {
    syncWeightLabels();
    persistSaved();
    settings = loadSettings();
    els.sourcePill.textContent = sourceLabel();
    document.querySelectorAll(".chip").forEach((el) => {
      el.classList.toggle("is-active", NexoData.normalize(el.dataset.niche) === NexoData.normalize("Barbearia"));
    });
    renderKanban();
    NexoSuggesters.init();
    initSidebar();
    bind();

    const source = settings.source || NexoConfig.defaultSource;
    if (source === "google" && settings.googleKey) {
      NexoSearch.loadGoogle(settings.googleKey).catch(() => {});
    }
  }

  init();

  return { openSettings, closeSettings, closeDrawer };
})();
