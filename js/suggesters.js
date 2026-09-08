window.NexoSuggesters = (() => {
  const STORAGE_NICHES = "nexo-recent-niches";
  const STORAGE_PLACES = "nexo-recent-places";

  const EXTRA_NICHES = [
    "Confeitaria",
    "Pizzaria",
    "Hamburgueria",
    "Lanchonete",
    "Food truck",
    "Sorveteria",
    "Açaiteria",
    "Churrascaria",
    "Sushi",
    "Delivery",
    "Hotel",
    "Pousada",
    "Hostel",
    "Estética",
    "Spa",
    "Tatuagem",
    "Studio de pilates",
    "Crossfit",
    "Personal trainer",
    "Escola de idiomas",
    "Curso preparatório",
    "Veterinário",
    "Banho e tosa",
    "Lava-jato",
    "Funilaria",
    "Borracharia",
    "Auto elétrica",
    "Vidraçaria",
    "Marcenaria",
    "Serralheria",
    "Construtora",
    "Arquitetura",
    "Contabilidade",
    "Corretora de seguros",
    "Corretora de imóveis",
    "Gráfica",
    "Papelaria",
    "Informática",
    "Assistência técnica",
    "Loja de celular",
    "Ótica",
    "Joalheria",
    "Floricultura",
    "Loja de roupas",
    "Loja de calçados",
    "Loja de móveis",
    "Loja de colchões",
    "Loja de eletro",
    "Distribuidora de bebidas",
    "Adega",
    "Tabacaria",
    "Sex shop",
    "Loja de conveniência",
  ];

  const POPULAR_PLACES = [
    { label: "Pinheiros, São Paulo", sub: "Bairro · São Paulo" },
    { label: "Vila Madalena, São Paulo", sub: "Bairro · São Paulo" },
    { label: "Moema, São Paulo", sub: "Bairro · São Paulo" },
    { label: "Jardins, São Paulo", sub: "Bairro · São Paulo" },
    { label: "Copacabana, Rio de Janeiro", sub: "Bairro · Rio" },
    { label: "Ipanema, Rio de Janeiro", sub: "Bairro · Rio" },
    { label: "Savassi, Belo Horizonte", sub: "Bairro · BH" },
    { label: "Centro, Curitiba", sub: "Bairro · Curitiba" },
    { label: "Boa Viagem, Recife", sub: "Bairro · Recife" },
    { label: "São Paulo, SP", sub: "Cidade" },
    { label: "Rio de Janeiro, RJ", sub: "Cidade" },
    { label: "Belo Horizonte, MG", sub: "Cidade" },
    { label: "Curitiba, PR", sub: "Cidade" },
    { label: "Porto Alegre, RS", sub: "Cidade" },
    { label: "Brasília, DF", sub: "Cidade" },
    { label: "Salvador, BA", sub: "Cidade" },
    { label: "Fortaleza, CE", sub: "Cidade" },
    { label: "Florianópolis, SC", sub: "Cidade" },
  ];

  const instances = [];

  function loadRecent(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      return [];
    }
  }

  function pushRecent(key, value, max = 8) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return;
    const list = loadRecent(key).filter((v) => v !== trimmed);
    list.unshift(trimmed);
    localStorage.setItem(key, JSON.stringify(list.slice(0, max)));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function allNiches() {
    const fromData = NexoData.categories.map((c) => c.label);
    return [...new Set([...fromData, ...EXTRA_NICHES])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  function matchQuery(text, query) {
    if (!query) return true;
    const nText = NexoData.normalize(text);
    const tokens = NexoData.normalize(query).split(/\s+/).filter(Boolean);
    return tokens.every((t) => nText.includes(t));
  }

  function nicheSuggestions(query) {
    const recent = loadRecent(STORAGE_NICHES).filter((n) => matchQuery(n, query));
    const pool = allNiches().filter((n) => matchQuery(n, query) && !recent.includes(n));
    const items = [
      ...recent.map((label) => ({ label, sub: "Recente", kind: "recent" })),
      ...pool.slice(0, 12).map((label) => ({ label, sub: "Nicho", kind: "niche" })),
    ];
    return items.slice(0, 10);
  }

  function placeSuggestions(query) {
    const recent = loadRecent(STORAGE_PLACES).filter((p) => matchQuery(p, query));
    const popular = POPULAR_PLACES.filter(
      (p) => matchQuery(p.label, query) && !recent.includes(p.label)
    );
    const items = [
      ...recent.map((label) => ({ label, sub: "Recente", kind: "recent" })),
      ...popular.map((p) => ({ ...p, kind: "popular" })),
    ];
    return items.slice(0, 8);
  }

  function formatPlaceRow(row) {
    const addr = row.address || {};
    const city = addr.city || addr.town || addr.municipality || "";
    const state = addr.state || "";
    const hood = addr.suburb || addr.neighbourhood || addr.quarter || "";
    let label = row.display_name?.split(",").slice(0, 3).join(", ") || row.display_name;
    if (hood && city && !label.includes(hood)) label = `${hood}, ${city}`;
    else if (city && state && !label.includes(city)) label = `${city}, ${state}`;
    const sub = [row.type, city, state].filter(Boolean).join(" · ");
    return { label, sub, kind: "live" };
  }

  async function livePlaceSuggestions(query) {
    if (!query || query.trim().length < 2) return [];
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=1&countrycodes=br&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return [];
      const data = await res.json();
      return data.map(formatPlaceRow);
    } catch {
      return [];
    }
  }

  async function googlePlaceSuggestions(query) {
    if (!query || query.length < 2 || !window.google?.maps?.places?.AutocompleteService) return [];
    return new Promise((resolve) => {
      const service = new google.maps.places.AutocompleteService();
      service.getPlacePredictions(
        {
          input: query,
          componentRestrictions: { country: "br" },
        },
        (predictions, status) => {
          if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions) {
            resolve([]);
            return;
          }
          resolve(
            predictions.slice(0, 5).map((p) => ({
              label: p.description,
              sub: "Google Places",
              kind: "google",
            }))
          );
        }
      );
    });
  }

  async function mergedPlaceSuggestions(query) {
    const staticItems = placeSuggestions(query);
    const [live, google] = await Promise.all([
      livePlaceSuggestions(query),
      googlePlaceSuggestions(query),
    ]);

    const seen = new Set();
    const merged = [];
    for (const item of [...staticItems, ...google, ...live]) {
      const key = item.label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged.slice(0, 10);
  }

  function attach(input, { getItems, asyncGetItems, onSelect }) {
    const wrap = document.createElement("div");
    wrap.className = "suggester";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const list = document.createElement("ul");
    list.className = "suggester-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    wrap.appendChild(list);

    let items = [];
    let active = -1;
    let reqId = 0;

    input.setAttribute("autocomplete", "off");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-autocomplete", "list");

    function close() {
      list.hidden = true;
      active = -1;
      input.setAttribute("aria-expanded", "false");
    }

    function render() {
      if (!items.length) {
        close();
        return;
      }

      let lastSection = "";
      list.innerHTML = items
        .map((item, i) => {
          const section =
            item.kind === "recent" ? "Recentes" : item.kind === "popular" ? "Populares" : item.kind === "live" || item.kind === "google" ? "Resultados" : "Sugestões";
          let sectionHtml = "";
          if (section !== lastSection) {
            lastSection = section;
            sectionHtml = `<li class="suggester-section" aria-hidden="true">${section}</li>`;
          }
          return `${sectionHtml}<li class="suggester-item${i === active ? " is-active" : ""}" role="option" data-index="${i}" aria-selected="${i === active}"><strong>${escapeHtml(item.label)}</strong>${item.sub ? `<span>${escapeHtml(item.sub)}</span>` : ""}</li>`;
        })
        .join("");

      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function pick(index) {
      const item = items[index];
      if (!item) return;
      input.value = item.label;
      close();
      onSelect?.(item);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    async function refresh() {
      const query = input.value.trim();
      const id = ++reqId;

      if (asyncGetItems) {
        list.innerHTML = `<li class="suggester-loading">Buscando…</li>`;
        list.hidden = false;
        items = await asyncGetItems(query);
        if (id !== reqId) return;
      } else {
        items = getItems(query);
      }

      active = items.length ? 0 : -1;
      render();
    }

    const debouncedRefresh = debounce(refresh, 280);

    input.addEventListener("focus", () => {
      refresh();
    });

    input.addEventListener("input", () => {
      debouncedRefresh();
    });

    input.addEventListener("blur", () => {
      setTimeout(close, 140);
    });

    input.addEventListener("keydown", (event) => {
      if (list.hidden && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        refresh();
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!items.length) return;
        active = Math.min(active + 1, items.length - 1);
        render();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!items.length) return;
        active = Math.max(active - 1, 0);
        render();
      } else if (event.key === "Enter" && active >= 0 && !list.hidden) {
        event.preventDefault();
        pick(active);
      } else if (event.key === "Escape") {
        close();
      }
    });

    list.addEventListener("mousedown", (event) => {
      const row = event.target.closest(".suggester-item");
      if (!row) return;
      event.preventDefault();
      pick(Number(row.dataset.index));
    });

    instances.push({ input, close });
    return { close, refresh };
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function closeAll() {
    instances.forEach((i) => i.close());
  }

  function rememberSearch(niche, place) {
    pushRecent(STORAGE_NICHES, niche);
    pushRecent(STORAGE_PLACES, place);
  }

  function init() {
    attach(document.getElementById("q-niche"), {
      getItems: nicheSuggestions,
    });

    attach(document.getElementById("q-place"), {
      asyncGetItems: mergedPlaceSuggestions,
    });
  }

  return { init, rememberSearch, closeAll, pushRecentNiche: (v) => pushRecent(STORAGE_NICHES, v), pushRecentPlace: (v) => pushRecent(STORAGE_PLACES, v) };
})();
