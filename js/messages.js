window.NexoMessages = (() => {
  function firstName(name) {
    return String(name || "equipe").split(/[\s|–-]/)[0].trim() || "equipe";
  }

  function approach(lead) {
    const r = Number(lead.rating);
    const n = Number(lead.reviews) || 0;

    if (r >= 4 && n >= 30) {
      return `Bom dia, tudo bem? Vi vocês no Google,\nPosso te fazer uma pergunta rápida?`;
    }
    if (n >= 10) {
      return `Bom dia, tudo bem? Achei a vocês no Maps e vi que vocês já têm movimento por aí.\nPosso te mandar uma dúvida de 10 segundos?`;
    }
    return `Bom dia, tudo bem? Vi a vocês no Google Maps.\nPosso te fazer uma pergunta rapidinha?`;
  }

  function question(lead) {
    const who = firstName(lead.name);
    const variants = [
      `Perfeito! Posso falar com o responsável da ${lead.name}?`,
      `Show! Quem cuida disso aí? Com quem eu posso falar sobre o digital da ${who}?`,
      `Combinado. Com quem eu falo pra tratar de site e Google da ${lead.name}?`,
    ];
    const idx = Math.abs(String(lead.id || lead.name || "").length) % variants.length;
    return variants[idx];
  }

  function proposal(lead) {
    const cat = lead.category.toLowerCase();
    const lines = [`Bom dia! Me chamo Lucas`];

    if (!lead.website) {
      lines.push(
        `Notei que vocês aparecem bem no Google, mas ainda não tem site próprio, e muita gente pesquisa online antes de ir até vocês.`
      );
    } else {
      lines.push(
        `Vi o site de vocês e dá para deixar a vitrine digital mais alinhada com a reputação que já têm no Google Maps.`
      );
    }

    if (cat.includes("padaria") || cat.includes("restaur") || cat.includes("café") || cat.includes("cafe")) {
      lines.push(
        `Trabalho com páginas para ${cat}s: cardápio online, pedidos e botão direto pro WhatsApp.`,
        `A ideia é simples: quem busca "${cat} perto de mim" acha vocês e já entra em contato.`,
        `Montei algo objetivo, sem enrolação técnica. Posso te mandar em 2 minutos?`
      );
    } else if (cat.includes("barbear") || cat.includes("salão") || cat.includes("beleza")) {
      lines.push(
        `Ajudo negócios de beleza a transformar avaliações do Google em agendamento online.`,
        `Site leve, serviços claros e WhatsApp na hora.`,
        `Tenho uma sugestão objetiva pra ${lead.name}. Te mando?`
      );
    } else if (cat.includes("clínica") || cat.includes("odonto") || cat.includes("médic")) {
      lines.push(
        `Faço sites para clínicas focados em confiança: serviços, equipe e contato rápido.`,
        `Quem pesquisa antes de marcar consulta precisa sentir segurança.`,
        `Posso te mostrar uma proposta curta, sem compromisso?`
      );
    } else if (cat.includes("oficina") || cat.includes("mecân")) {
      lines.push(
        `Crio sites para oficinas: serviços, localização clara e WhatsApp em um clique.`,
        `O cliente encontra vocês na hora do problema.`,
        `Tenho uma ideia prática pra ${lead.name}. Mando?`
      );
    } else {
      lines.push(
        `Montei uma proposta de site + Google pensada pra ${cat}s como a ${lead.name}.`,
        `Objetivo: quem busca no Google encontra, confia e chama no WhatsApp.`,
        `É objetivo e sem complicação. Posso te enviar?`
      );
    }

    return lines.slice(0, 5).join("\n");
  }

  function compose(lead, context = {}) {
    void context;
    return {
      approach: approach(lead),
      question: question(lead),
      proposal: proposal(lead),
    };
  }

  function normalizePhone(lead) {
    if (!NexoScoring.isMobilePhone(lead.phone)) return null;
    const digits = String(lead.phone || "").replace(/\D/g, "");
    if (!digits) return null;
    return digits.startsWith("55") ? digits : `55${digits}`;
  }

  function whatsappLinks(lead, message) {
    const phone = normalizePhone(lead);
    if (!phone) return null;
    const text = encodeURIComponent(message);
    return {
      app: `whatsapp://send?phone=${phone}&text=${text}`,
      web: `https://wa.me/${phone}?text=${text}`,
    };
  }

  function whatsappUrl(lead, message) {
    const links = whatsappLinks(lead, message);
    return links ? links.app : null;
  }

  function openWhatsApp(lead, message) {
    const links = whatsappLinks(lead, message);
    if (!links) return false;

    window.location.assign(links.app);

    const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);
    if (!isMobile && links.web) {
      setTimeout(() => {
        if (document.visibilityState === "visible") {
          window.open(links.web, "_blank", "noopener");
        }
      }, 1500);
    }

    return true;
  }

  return { compose, approach, question, proposal, whatsappUrl, whatsappLinks, openWhatsApp, firstName };
})();
