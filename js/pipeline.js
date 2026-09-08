window.NexoPipeline = (() => {
  const COLUMNS = [
    { id: "queue", label: "Fila", hint: "Salvos para contato" },
    { id: "contacted", label: "Contatado", hint: "Mensagem enviada" },
    { id: "replied", label: "Respondeu", hint: "Retorno recebido" },
    { id: "won", label: "Fechou", hint: "Negócio ganho" },
  ];

  function normalizeStatus(status) {
    return COLUMNS.some((c) => c.id === status) ? status : "queue";
  }

  function columnCounts(leads) {
    const counts = Object.fromEntries(COLUMNS.map((c) => [c.id, 0]));
    for (const lead of leads) {
      counts[normalizeStatus(lead.pipelineStatus)] += 1;
    }
    return counts;
  }

  function kanbanCard(lead, escapeHtml) {
    const status = normalizeStatus(lead.pipelineStatus);
    const others = COLUMNS.filter((c) => c.id !== status);
    return `
      <article class="kanban-card" draggable="true" data-id="${escapeHtml(lead.id)}" tabindex="0">
        <div class="kanban-card-top">
          <strong>${escapeHtml(lead.name)}</strong>
          <span class="kanban-score">${lead.score}</span>
        </div>
        <p>${escapeHtml(lead.category)}${
          lead.hours?.summary ? ` · ${escapeHtml(lead.hours.summary)}` : ""
        }</p>
        <div class="kanban-card-actions">
          <button class="tiny" type="button" data-kanban-open>Abrir</button>
          <button class="tiny" type="button" data-kanban-msg>Msg</button>
          ${others
            .slice(0, 2)
            .map((c) => `<button class="tiny" type="button" data-kanban-move="${c.id}">→ ${c.label}</button>`)
            .join("")}
        </div>
      </article>
    `;
  }

  function render(boardEl, leads, escapeHtml) {
    const byCol = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
    for (const lead of leads) {
      byCol[normalizeStatus(lead.pipelineStatus)].push(lead);
    }

    boardEl.innerHTML = COLUMNS.map((col) => {
      const items = byCol[col.id];
      return `
        <div class="kanban-col" data-column="${col.id}">
          <header class="kanban-col-head">
            <h3>${col.label}</h3>
            <span>${items.length}</span>
            <p>${col.hint}</p>
          </header>
          <div class="kanban-drop" data-drop="${col.id}">
            ${
              items.length
                ? items.map((l) => kanbanCard(l, escapeHtml)).join("")
                : `<div class="kanban-empty">Arraste leads aqui</div>`
            }
          </div>
        </div>
      `;
    }).join("");
  }

  return { COLUMNS, normalizeStatus, columnCounts, render };
})();
