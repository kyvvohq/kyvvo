const token = localStorage.getItem('kyvvo_token');

document.getElementById('btn-sair').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    // Sem conexão: prossegue com o logout local mesmo assim.
  }
  localStorage.removeItem('kyvvo_token');
  localStorage.removeItem('kyvvo_nome');
  localStorage.removeItem('kyvvo_email');
  window.location.href = '/login.html';
});

// US20 — guarda de e-mail não validado (CA10) + banner de trial (CA09) + toast
// de sucesso pós-validação (CA08). Falha na chamada de status não bloqueia o
// portal (fail-open): usuários antigos já são email_verified=true na migration.
// mostrarToast() é definido mais abaixo (seção Toasts).
async function verificarStatusConta() {
  let status;
  try {
    const res = await fetch('/api/tenant/status', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    status = await res.json();
  } catch (e) {
    return;
  }

  // CA10 — conta não validada: acesso ao portal bloqueado até validar.
  if (status.email_verified === false) {
    window.location.href = '/verificar.html';
    return;
  }

  // CA08 — toast verde ao voltar da validação do token.
  if (new URLSearchParams(location.search).get('verificado') === '1') {
    mostrarToast('E-mail verificado! Seu trial de 14 dias está ativo.', 'sucesso');
    history.replaceState(null, '', location.pathname);
  }

  // CA09 — banner de trial com contador de dias restantes.
  const banner = document.getElementById('trial-banner');
  if (banner && status.status === 'trial' && status.dias_restantes != null) {
    const dias = status.dias_restantes;
    const texto = dias === 1 ? '1 dia restante' : `${dias} dias restantes`;
    banner.textContent = `🎉 Trial ativo — ${texto}. Escolha seu plano antes que expire.`;
    banner.hidden = false;
    document.body.classList.add('com-trial-banner');
  }
}
verificarStatusConta();

function saudacaoPorHorario() {
  const hora = new Date().toLocaleString('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' });
  const h = parseInt(hora, 10);
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

const nomeUsuario = (localStorage.getItem('kyvvo_nome') || '').split(' ')[0] || '';
document.getElementById('saudacao').textContent = `${saudacaoPorHorario()}${nomeUsuario ? ', ' + nomeUsuario : ''}!`;

const conteudo = document.getElementById('conteudo');
const menuEl = document.querySelector('.menu');
const subtabsEl = document.getElementById('subtabs');
const tabs = document.querySelectorAll('.tab');
let menuAtual = 'agendamento';
let abaAtual = 'dia';
let dataRef = new Date();
let configuracao = { dias_funcionamento: [1, 2, 3, 4, 5, 6], formato_hora: '24h' };

async function carregarConfiguracao() {
  const dados = await api('/api/configuracao');
  if (dados) configuracao = dados;
}

function ativarMenuItem(item) {
  menuEl.querySelectorAll('.menu-item').forEach((i) => i.classList.remove('active'));
  item.classList.add('active');
  menuAtual = item.dataset.menu;
  subtabsEl.style.display = menuAtual === 'agendamento' ? 'flex' : 'none';
  dataRef = new Date();
  render();
}

menuEl.querySelectorAll('.menu-item').forEach((item) => {
  item.addEventListener('click', () => ativarMenuItem(item));
});

// ---------- Menu dinâmico por módulo (ST10.3) ----------
// Os itens fixos (Agendamento/Perfil/Configuração) continuam sempre visíveis
// (CA05). Aqui só acrescentamos um item de menu por módulo ativo do tenant,
// além do "agenda_inteligente" (que já é coberto pelo item fixo
// "Agendamento"). As telas de cada módulo (financeiro, dashboards etc.) são
// escopo de USs futuras — o clique mostra só um aviso de "em breve".
async function carregarModulosNoMenu() {
  const resultado = await api('/api/tenant/modulos');
  if (!resultado || !Array.isArray(resultado.modulos)) return;

  resultado.modulos
    .filter((m) => m.key !== 'agenda_inteligente')
    .forEach((m) => {
      const item = document.createElement('div');
      item.className = 'menu-item';
      item.dataset.menu = `modulo:${m.key}`;
      item.textContent = m.nome;
      item.addEventListener('click', () => ativarMenuItem(item));
      menuEl.appendChild(item);
    });
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    abaAtual = tab.dataset.tab;
    dataRef = new Date();
    render();
  });
});

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('kyvvo_token');
    window.location.href = '/login.html';
    return null;
  }
  return res.json();
}

function formatarDataISO(d) {
  return d.toISOString().slice(0, 10);
}

function formatarHora(dataHoraISO) {
  const d = new Date(dataHoraISO);
  if (configuracao.formato_hora === '12h') {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Sao_Paulo' });
  }
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' });
}

function nomeDiaSemana(d) {
  return d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
}

function formatarDataCurta(dataHoraISO) {
  return new Date(dataHoraISO).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

// ---------- Toasts ----------
function mostrarToast(mensagem, tipo = 'sucesso') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.textContent = (tipo === 'sucesso' ? '✅ ' : '❌ ') + mensagem;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-saindo');
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

// ---------- Modal genérico ----------
function escFecharModal(e) {
  if (e.key === 'Escape') fecharModal();
}

function fecharModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', escFecharModal);
}

function abrirModal(tituloHtml, conteudoHtml, classeExtra) {
  fecharModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card${classeExtra ? ` ${classeExtra}` : ''}">
      <button class="modal-close" id="modal-close" aria-label="Fechar">✕</button>
      ${tituloHtml}
      ${conteudoHtml}
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('modal-close').addEventListener('click', fecharModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharModal(); });
  document.addEventListener('keydown', escFecharModal);
  return overlay;
}

// ---------- Modal: novo agendamento (ST09.1 a ST09.5) ----------
// Ponto de entrada do fluxo de cadastro manual (US09). A ST09.1 entregou o
// botão em destaque na agenda e a abertura do modal; a ST09.2 montou o
// formulário com todos os campos e a validação de obrigatórios com destaque
// visual em vermelho; a ST09.3 integra o dropdown de horário com
// GET /agendamentos/disponibilidade — slots ocupados desabilitados, skeleton
// loader durante a carga e aviso quando não há horário livre na data; a
// ST09.5 (submit) salva via POST /api/agendamentos (origem "portal", que a
// ST09.4 já faz upsert de cliente por telefone), fecha o modal, atualiza a
// agenda e exibe o toast de sucesso.

// Marca em vermelho os campos [data-obrigatorio] vazios e devolve o primeiro
// inválido (ou null se estiver tudo preenchido).
function validarObrigatorios(form) {
  let primeiroInvalido = null;
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    const vazio = !campo.value || !campo.value.trim();
    campo.classList.toggle('campo-invalido', vazio);
    if (vazio && !primeiroInvalido) primeiroInvalido = campo;
  });
  return primeiroInvalido;
}

function abrirModalNovoAgendamento() {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Novo agendamento</h3>',
    `
      <form id="form-novo-agendamento" novalidate>
        <div class="modal-erro" id="novo-ag-erro"></div>

        <label for="novo-ag-nome">Nome do cliente *</label>
        <input type="text" id="novo-ag-nome" data-obrigatorio autocomplete="off">

        <label for="novo-ag-telefone">Telefone *</label>
        <input type="tel" id="novo-ag-telefone" data-obrigatorio placeholder="11999999999" autocomplete="off">

        <label for="novo-ag-servico">Serviço *</label>
        <select id="novo-ag-servico" data-obrigatorio><option value="">Carregando serviços...</option></select>

        <label for="novo-ag-profissional">Profissional *</label>
        <select id="novo-ag-profissional" data-obrigatorio><option value="">Carregando profissionais...</option></select>

        <label for="novo-ag-data">Data *</label>
        <input type="date" id="novo-ag-data" min="${hoje}" data-obrigatorio>

        <label for="novo-ag-horario">Horário *</label>
        <select id="novo-ag-horario" data-obrigatorio><option value="">Selecione serviço, profissional e data</option></select>
        <div class="skeleton-horario" id="novo-ag-horario-skeleton" hidden aria-hidden="true"></div>
        <div class="campo-aviso" id="novo-ag-horario-aviso"></div>

        <label for="novo-ag-observacoes">Observações</label>
        <textarea id="novo-ag-observacoes" rows="3" placeholder="Anotações internas sobre o agendamento"></textarea>

        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-novo-ag">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-novo-ag">Salvar agendamento</button>
        </div>
      </form>
    `
  );

  const form = document.getElementById('form-novo-agendamento');
  const erroEl = document.getElementById('novo-ag-erro');

  document.getElementById('btn-cancelar-novo-ag').addEventListener('click', fecharModal);

  // Ao corrigir um campo, remove o destaque vermelho imediatamente.
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    const limpar = () => campo.classList.remove('campo-invalido');
    campo.addEventListener('input', limpar);
    campo.addEventListener('change', limpar);
  });

  // Popula serviços (reutiliza GET /api/servicos, como no encaixe da ST08.6).
  api('/api/servicos').then((resultado) => {
    const select = document.getElementById('novo-ag-servico');
    if (!resultado || !resultado.servicos) {
      select.innerHTML = '<option value="">Erro ao carregar serviços</option>';
      return;
    }
    select.innerHTML = '<option value="">Selecione...</option>' +
      resultado.servicos.map((s) => `<option value="${s.id}">${s.nome} (${s.duracao_minutos}min)</option>`).join('');
  });

  // Popula profissionais (GET /api/profissionais).
  api('/api/profissionais').then((resultado) => {
    const select = document.getElementById('novo-ag-profissional');
    if (!resultado || !resultado.profissionais) {
      select.innerHTML = '<option value="">Erro ao carregar profissionais</option>';
      return;
    }
    select.innerHTML = '<option value="">Selecione...</option>' +
      resultado.profissionais.map((p) => `<option value="${p.id}">${p.nome}</option>`).join('');
  });

  // ST09.3 — Carrega os slots reais de GET /agendamentos/disponibilidade sempre
  // que serviço, profissional e data estiverem selecionados (os três parâmetros
  // exigidos pelo endpoint; o serviço define a duração usada para montar os
  // slots). Reutiliza o mesmo endpoint da ST08.2 e o helper popularSelectHorarios
  // do reagendamento/encaixe. Slots ocupados ficam desabilitados com "(ocupado)".
  async function carregarSlotsNovoAgendamento() {
    const servicoId = document.getElementById('novo-ag-servico').value;
    const profissionalId = document.getElementById('novo-ag-profissional').value;
    const data = document.getElementById('novo-ag-data').value;
    const select = document.getElementById('novo-ag-horario');
    const skeleton = document.getElementById('novo-ag-horario-skeleton');
    const aviso = document.getElementById('novo-ag-horario-aviso');

    aviso.textContent = '';

    if (!servicoId || !profissionalId || !data) {
      select.hidden = false;
      skeleton.hidden = true;
      select.innerHTML = '<option value="">Selecione serviço, profissional e data</option>';
      return;
    }

    // Skeleton loader (CA08): esconde o select e mostra a barra de carregamento.
    select.hidden = true;
    select.innerHTML = '<option value="">Carregando horários...</option>';
    skeleton.hidden = false;

    // O select e o skeleton precisam voltar ao estado visível mesmo se a
    // chamada falhar (erro de rede, backend fora do ar etc.) — sem o
    // try/finally, uma falha aqui deixava o dropdown escondido pra sempre e o
    // formulário ficava impossível de preencher/salvar.
    let disponibilidade;
    try {
      disponibilidade = await api(
        `/api/agendamentos/disponibilidade?data=${data}&profissional=${profissionalId}&servico=${servicoId}`
      );
    } catch (erro) {
      disponibilidade = null;
    } finally {
      skeleton.hidden = true;
      select.hidden = false;
    }

    if (!disponibilidade || disponibilidade.error || !Array.isArray(disponibilidade.slots)) {
      select.innerHTML = '<option value="">Erro ao carregar horários</option>';
      aviso.textContent = (disponibilidade && disponibilidade.error) || 'Não foi possível carregar os horários. Tente novamente.';
      return;
    }

    // CA03: sem nenhum horário livre na data selecionada.
    if (!disponibilidade.slots.some((s) => s.disponivel)) {
      select.innerHTML = '<option value="">Nenhum horário disponível</option>';
      aviso.textContent = 'Nenhum horário disponível nesta data. Tente outra data.';
      return;
    }

    popularSelectHorarios(select, disponibilidade.slots);
    // O valor é definido programaticamente (não dispara "change"), então limpa
    // o destaque de erro manualmente caso a validação já o tivesse marcado.
    select.classList.remove('campo-invalido');
  }

  ['novo-ag-servico', 'novo-ag-profissional', 'novo-ag-data'].forEach((id) => {
    document.getElementById(id).addEventListener('change', carregarSlotsNovoAgendamento);
  });
  // O calendário nativo já dispara "change" ao escolher uma data. Para quem
  // prefere digitar a data direto no campo, o "input" garante que os horários
  // recarreguem assim que a data digitada ficar completa/válida, sem precisar
  // esperar o campo perder o foco.
  document.getElementById('novo-ag-data').addEventListener('input', carregarSlotsNovoAgendamento);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-novo-ag');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/agendamentos', {
      method: 'POST',
      body: JSON.stringify({
        cliente_nome: document.getElementById('novo-ag-nome').value.trim(),
        cliente_telefone: document.getElementById('novo-ag-telefone').value.trim(),
        servico_id: document.getElementById('novo-ag-servico').value,
        profissional_id: document.getElementById('novo-ag-profissional').value,
        data_hora: document.getElementById('novo-ag-horario').value,
        observacoes: document.getElementById('novo-ag-observacoes').value.trim() || null,
        origem: 'portal',
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento cadastrado com sucesso.', 'sucesso');
      render();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar agendamento.';
      btn.disabled = false;
      btn.textContent = 'Salvar agendamento';
    }
  });
}

document.getElementById('btn-novo-agendamento').addEventListener('click', abrirModalNovoAgendamento);

// ---------- Modal: cancelamento (ST08.4) ----------
function abrirModalCancelar(ag) {
  abrirModal(
    '<h3>Cancelar agendamento</h3>',
    `
      <p class="modal-texto">Tem certeza que deseja cancelar o agendamento de <strong>${ag.cliente || ag.cliente_telefone}</strong> — ${ag.servico} — ${formatarDataCurta(ag.data_hora)} às ${formatarHora(ag.data_hora)}?</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-cancelar">Voltar</button>
        <button class="btn-perigo" id="btn-confirmar-cancelar">Confirmar cancelamento</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-cancelar').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-cancelar').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-cancelar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelado' }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      render();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao cancelar agendamento.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Confirmar cancelamento';
    }
  });
}

// ---------- Modal: reagendamento (ST08.5) ----------
function popularSelectHorarios(select, slots, bloquearOcupado = true) {
  select.innerHTML = slots
    .map((s) => `<option value="${s.hora}" ${!s.disponivel && bloquearOcupado ? 'disabled' : ''}>${formatarHora(s.hora)}${!s.disponivel ? ' (ocupado)' : ''}</option>`)
    .join('');
  const primeiraSelecionavel = bloquearOcupado ? slots.find((s) => s.disponivel) : slots[0];
  if (primeiraSelecionavel) select.value = primeiraSelecionavel.hora;
  return !!primeiraSelecionavel;
}

function abrirModalReagendar(ag) {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Reagendar</h3>',
    `
      <div class="modal-erro" id="reagendar-erro"></div>
      <label for="reagendar-data">Nova data</label>
      <input type="date" id="reagendar-data" min="${hoje}" value="${ag.data_hora.slice(0, 10)}">
      <label for="reagendar-horario">Novo horário</label>
      <select id="reagendar-horario"><option>Carregando horários...</option></select>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-reagendar">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-reagendar" disabled>Confirmar</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-reagendar').addEventListener('click', fecharModal);

  async function carregarSlots() {
    const data = document.getElementById('reagendar-data').value;
    const select = document.getElementById('reagendar-horario');
    const btnConfirmar = document.getElementById('btn-confirmar-reagendar');
    select.innerHTML = '<option>Carregando horários...</option>';
    btnConfirmar.disabled = true;

    const disponibilidade = await api(`/api/agendamentos/disponibilidade?data=${data}&profissional=${ag.profissional_id}&servico=${ag.servico_id}`);
    if (!disponibilidade || disponibilidade.error) {
      select.innerHTML = '<option>Erro ao carregar horários</option>';
      return;
    }
    btnConfirmar.disabled = !popularSelectHorarios(select, disponibilidade.slots);
  }

  document.getElementById('reagendar-data').addEventListener('change', carregarSlots);
  document.getElementById('reagendar-horario').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    document.getElementById('btn-confirmar-reagendar').disabled = !opt || opt.disabled;
  });

  document.getElementById('btn-confirmar-reagendar').addEventListener('click', async () => {
    const erroEl = document.getElementById('reagendar-erro');
    erroEl.textContent = '';
    const btn = document.getElementById('btn-confirmar-reagendar');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    const resultado = await api(`/api/agendamentos/${ag.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data_hora: document.getElementById('reagendar-horario').value }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      render();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao reagendar.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });

  carregarSlots();
}

// ---------- Modal: encaixe (ST08.6) ----------
function abrirModalEncaixe(ag) {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    `<h3>Encaixe — ${ag.profissional}</h3>`,
    `
      <div class="modal-erro" id="encaixe-erro"></div>
      <label for="encaixe-nome">Nome do cliente (opcional)</label>
      <input type="text" id="encaixe-nome">
      <label for="encaixe-whatsapp">WhatsApp</label>
      <input type="tel" id="encaixe-whatsapp" placeholder="11999999999">
      <label for="encaixe-servico">Serviço</label>
      <select id="encaixe-servico"><option value="">Carregando serviços...</option></select>
      <label for="encaixe-data">Data</label>
      <input type="date" id="encaixe-data" min="${hoje}" value="${ag.data_hora.slice(0, 10)}">
      <label for="encaixe-horario">Horário</label>
      <select id="encaixe-horario"><option>Selecione um serviço primeiro</option></select>
      <p class="modal-texto">Encaixe pode sobrepor um horário já ocupado — os marcados "(ocupado)" continuam selecionáveis de propósito.</p>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-encaixe">Voltar</button>
        <button class="btn-primario" id="btn-confirmar-encaixe" disabled>Confirmar encaixe</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-encaixe').addEventListener('click', fecharModal);

  async function carregarSlotsEncaixe() {
    const servicoId = document.getElementById('encaixe-servico').value;
    const data = document.getElementById('encaixe-data').value;
    const selectHorario = document.getElementById('encaixe-horario');
    const btnConfirmar = document.getElementById('btn-confirmar-encaixe');
    if (!servicoId) {
      selectHorario.innerHTML = '<option>Selecione um serviço primeiro</option>';
      btnConfirmar.disabled = true;
      return;
    }
    selectHorario.innerHTML = '<option>Carregando horários...</option>';
    btnConfirmar.disabled = true;

    const disponibilidade = await api(`/api/agendamentos/disponibilidade?data=${data}&profissional=${ag.profissional_id}&servico=${servicoId}`);
    if (!disponibilidade || disponibilidade.error) {
      selectHorario.innerHTML = '<option>Erro ao carregar horários</option>';
      return;
    }
    btnConfirmar.disabled = !popularSelectHorarios(selectHorario, disponibilidade.slots, false);
  }

  api('/api/servicos').then((resultado) => {
    const select = document.getElementById('encaixe-servico');
    if (!resultado || !resultado.servicos) {
      select.innerHTML = '<option value="">Erro ao carregar serviços</option>';
      return;
    }
    select.innerHTML = '<option value="">Selecione...</option>' +
      resultado.servicos.map((s) => `<option value="${s.id}">${s.nome} (${s.duracao_minutos}min)</option>`).join('');
  });

  document.getElementById('encaixe-servico').addEventListener('change', carregarSlotsEncaixe);
  document.getElementById('encaixe-data').addEventListener('change', carregarSlotsEncaixe);
  document.getElementById('encaixe-horario').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    document.getElementById('btn-confirmar-encaixe').disabled = !opt || opt.disabled;
  });

  document.getElementById('btn-confirmar-encaixe').addEventListener('click', async () => {
    const erroEl = document.getElementById('encaixe-erro');
    erroEl.textContent = '';
    const whatsapp = document.getElementById('encaixe-whatsapp').value.trim();
    if (!whatsapp) {
      erroEl.textContent = 'Informe o WhatsApp do cliente.';
      return;
    }
    const btn = document.getElementById('btn-confirmar-encaixe');
    btn.disabled = true;
    btn.textContent = 'Confirmando...';

    const resultado = await api('/api/agendamentos', {
      method: 'POST',
      body: JSON.stringify({
        cliente_nome: document.getElementById('encaixe-nome').value.trim() || null,
        cliente_telefone: whatsapp,
        profissional_id: ag.profissional_id,
        servico_id: document.getElementById('encaixe-servico').value,
        data_hora: document.getElementById('encaixe-horario').value,
        encaixe: true,
      }),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Agendamento atualizado com sucesso.', 'sucesso');
      render();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao criar encaixe.';
      btn.disabled = false;
      btn.textContent = 'Confirmar encaixe';
    }
  });

  carregarSlotsEncaixe();
}

// ---------- Menu de ações inline (ST08.3) ----------
let agendamentosAtuais = [];

function renderAgendamentoItem(ag) {
  const cancelado = ag.status === 'cancelado';
  return `
    <div class="agendamento-item${cancelado ? ' agendamento-cancelado' : ''}" data-id="${ag.id}">
      <div class="agendamento-linha-principal" ${cancelado ? '' : `data-acoes-toggle="${ag.id}"`}>
        <div>
          <div class="agendamento-hora">${formatarHora(ag.data_hora)} — ${ag.servico}</div>
          <div class="agendamento-detalhe">
            ${ag.cliente || ag.cliente_telefone} · ${ag.profissional} · ${ag.duracao_minutos}min
            ${ag.encaixe ? '<span class="badge badge-encaixe">Encaixe</span>' : ''}
            ${cancelado ? '<span class="badge badge-cancelado">Cancelado</span>' : ''}
          </div>
        </div>
        ${cancelado ? '' : '<button class="btn-acoes" aria-label="Ações">⋮</button>'}
      </div>
      ${cancelado ? '' : `
        <div class="menu-acoes" id="menu-acoes-${ag.id}">
          <button data-acao="reagendar" data-id="${ag.id}">Reagendar</button>
          <button data-acao="encaixar" data-id="${ag.id}">Encaixar</button>
          <button data-acao="cancelar" data-id="${ag.id}" class="acao-perigo">Cancelar</button>
        </div>
      `}
    </div>
  `;
}

conteudo.addEventListener('click', (e) => {
  const toggleEl = e.target.closest('[data-acoes-toggle]');
  if (toggleEl) {
    const id = toggleEl.dataset.acoesToggle;
    const menu = document.getElementById(`menu-acoes-${id}`);
    const jaAberto = menu.classList.contains('aberto');
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    if (!jaAberto) menu.classList.add('aberto');
    return;
  }

  const acaoBtn = e.target.closest('[data-acao]');
  if (acaoBtn) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    const ag = agendamentosAtuais.find((a) => a.id === acaoBtn.dataset.id);
    if (!ag) return;
    if (acaoBtn.dataset.acao === 'cancelar') abrirModalCancelar(ag);
    if (acaoBtn.dataset.acao === 'reagendar') abrirModalReagendar(ag);
    if (acaoBtn.dataset.acao === 'encaixar') abrirModalEncaixe(ag);
  }

  // US17 — ações de editar/excluir nas listas de Serviços e Profissionais.
  // Usam atributos próprios (data-acao-servico/data-acao-profissional), não
  // "data-acao", pra não colidir com a busca em agendamentosAtuais acima.
  const acaoServicoBtn = e.target.closest('[data-acao-servico]');
  if (acaoServicoBtn) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    const servico = servicosAtuais.find((s) => s.id === acaoServicoBtn.dataset.id);
    if (!servico) return;
    if (acaoServicoBtn.dataset.acaoServico === 'editar') abrirModalServico(servico);
    if (acaoServicoBtn.dataset.acaoServico === 'excluir') abrirModalExcluirServico(servico);
  }

  const acaoProfissionalBtn = e.target.closest('[data-acao-profissional]');
  if (acaoProfissionalBtn) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
    const profissional = profissionaisAtuais.find((p) => p.id === acaoProfissionalBtn.dataset.id);
    if (!profissional) return;
    if (acaoProfissionalBtn.dataset.acaoProfissional === 'editar') abrirModalProfissional(profissional);
    if (acaoProfissionalBtn.dataset.acaoProfissional === 'excluir') abrirModalExcluirProfissional(profissional);
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.agendamento-item')) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
  }
});

const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Segmento de negócio do tenant — só adapta a terminologia do texto de "dias
// de funcionamento" na Configuração, sem mudar comportamento. Mesma lista
// fixa validada no backend.
const SEGMENTOS = {
  salao_beleza: { dias: 'o salão' },
  petshop: { dias: 'o petshop' },
  psicologia: { dias: 'o consultório' },
  fisioterapia: { dias: 'a clínica' },
  pilates: { dias: 'o studio' },
  outro: { dias: 'o negócio' },
};
function infoSegmento(segmento) {
  return SEGMENTOS[segmento] || SEGMENTOS.outro;
}

// ---------- Financeiro (US18) ----------
// Livro-caixa manual simples — primeira funcionalidade real do módulo
// "financeiro" (só aparece no menu se o tenant tiver o módulo ativo, via
// carregarModulosNoMenu). Sem edição/exclusão de lançamento nesta versão —
// escopo combinado foi só registrar e listar.
let mesFinanceiroRef = new Date();

function renderLancamentoItem(l) {
  const sinal = l.tipo === 'entrada' ? '+' : '−';
  const classeTipo = l.tipo === 'entrada' ? 'financeiro-entrada' : 'financeiro-saida';
  const dataLabel = new Date(l.data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `
    <div class="agendamento-item">
      <div class="agendamento-linha-principal">
        <div>
          <div class="agendamento-hora">${l.descricao || (l.tipo === 'entrada' ? 'Entrada' : 'Saída')}</div>
          <div class="agendamento-detalhe">${dataLabel}</div>
        </div>
        <div class="${classeTipo}">${sinal} ${formatarPreco(l.valor)}</div>
      </div>
    </div>
  `;
}

async function renderFinanceiro() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const mesISO = formatarDataISO(mesFinanceiroRef).slice(0, 7);
  const data = await api(`/api/financeiro/lancamentos?mes=${mesISO}`);
  if (!data) return;

  const mesLabel = mesFinanceiroRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  let html = `
    <div class="nav-periodo">
      <button data-nav="-1">← Mês anterior</button>
      <strong>${mesLabel}</strong>
      <button data-nav="1">Próximo mês →</button>
    </div>
    <div class="financeiro-resumo">
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Entradas</div>
        <div class="financeiro-entrada">${formatarPreco(data.resumo.entradas)}</div>
      </div>
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Saídas</div>
        <div class="financeiro-saida">${formatarPreco(data.resumo.saidas)}</div>
      </div>
      <div class="financeiro-resumo-card">
        <div class="financeiro-resumo-label">Saldo</div>
        <div class="${data.resumo.saldo >= 0 ? 'financeiro-entrada' : 'financeiro-saida'}">${formatarPreco(data.resumo.saldo)}</div>
      </div>
    </div>
    <button class="btn-novo-agendamento" id="btn-novo-lancamento" style="margin-bottom:16px">+ Novo lançamento</button>
  `;

  html += data.lancamentos.length
    ? data.lancamentos.map(renderLancamentoItem).join('')
    : '<div class="vazio">Nenhum lançamento neste mês.</div>';

  conteudo.innerHTML = html;
  conteudo.querySelector('[data-nav="-1"]').addEventListener('click', () => {
    mesFinanceiroRef.setMonth(mesFinanceiroRef.getMonth() - 1);
    renderFinanceiro();
  });
  conteudo.querySelector('[data-nav="1"]').addEventListener('click', () => {
    mesFinanceiroRef.setMonth(mesFinanceiroRef.getMonth() + 1);
    renderFinanceiro();
  });
  document.getElementById('btn-novo-lancamento').addEventListener('click', abrirModalLancamento);
}

function abrirModalLancamento() {
  const hoje = formatarDataISO(new Date());
  abrirModal(
    '<h3>Novo lançamento</h3>',
    `
      <form id="form-lancamento">
        <div class="modal-erro" id="lancamento-erro"></div>
        <label for="lancamento-tipo">Tipo *</label>
        <select id="lancamento-tipo" data-obrigatorio>
          <option value="entrada">Entrada</option>
          <option value="saida">Saída</option>
        </select>
        <label for="lancamento-valor">Valor em R$ *</label>
        <input type="number" id="lancamento-valor" data-obrigatorio min="0.01" step="0.01">
        <label for="lancamento-data">Data *</label>
        <input type="date" id="lancamento-data" data-obrigatorio value="${hoje}">
        <label for="lancamento-descricao">Descrição (opcional)</label>
        <input type="text" id="lancamento-descricao" placeholder="Ex: venda do dia, compra de material...">
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-lancamento">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-lancamento">Salvar</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-lancamento').addEventListener('click', fecharModal);

  const form = document.getElementById('form-lancamento');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('lancamento-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-lancamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const payload = {
      tipo: document.getElementById('lancamento-tipo').value,
      valor: parseFloat(document.getElementById('lancamento-valor').value),
      data: document.getElementById('lancamento-data').value,
      descricao: document.getElementById('lancamento-descricao').value.trim() || null,
    };

    const resultado = await api('/api/financeiro/lancamentos', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Lançamento registrado com sucesso.', 'sucesso');
      renderFinanceiro();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar lançamento.';
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });
}

// ---------- Pagamentos / Asaas (US32) ----------
const PAGAMENTOS_STATUS_LABEL = {
  trial: 'Trial',
  ativo: 'Ativo',
  inadimplente: 'Inadimplente',
  suspenso: 'Suspenso',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
};
const PAGAMENTOS_STATUS_BADGE = {
  trial: 'badge-trial-ativo',
  ativo: 'badge-status-ativo',
  inadimplente: 'badge-status-inadimplente',
  suspenso: 'badge-status-suspenso',
  expirado: 'badge-trial-expirado',
  cancelado: 'badge-status-inativo',
};

function formatarDataCurtaISO(dataISO) {
  if (!dataISO) return '—';
  // dueDate/data vêm como "YYYY-MM-DD" (sem hora) tanto do banco quanto da
  // Asaas — new Date("YYYY-MM-DD") interpreta como UTC meia-noite, então
  // formata os componentes direto da string em vez de usar o Date local.
  const [ano, mes, dia] = dataISO.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

// CA01-CA06 (US36) — bloco de status do trial na aba de pagamentos: badge +
// barra de progresso + CTA, com 3 estados (ativo / expirando ≤3 dias /
// expirado) derivados de trial_ativo e trial_dias_restantes.
function renderBlocoTrial(trialInfo) {
  const diasRestantes = trialInfo.trial_dias_restantes;
  const percentual = trialInfo.trial_percentual != null ? Math.min(100, Math.max(0, trialInfo.trial_percentual)) : 0;
  const corBarra = percentual > 80 ? 'trial-barra-vermelha' : percentual > 50 ? 'trial-barra-amarela' : 'trial-barra-verde';

  let badgeClasse = 'badge-trial-ativo';
  let badgeTexto = 'TRIAL ATIVO';
  let mensagem = 'Você está no período gratuito de 14 dias.';
  let cta = trialInfo.trial_fim
    ? `Garanta seu acesso — cadastre uma forma de pagamento agora e não pague nada até ${formatarDataCurtaISO(trialInfo.trial_fim)}.`
    : '';

  if (!trialInfo.trial_ativo) {
    badgeClasse = 'badge-trial-expirado';
    badgeTexto = 'TRIAL EXPIRADO';
    mensagem = 'Seu período gratuito encerrou. Cadastre uma forma de pagamento para continuar usando o Kyvvo.';
    cta = '';
  } else if (diasRestantes != null && diasRestantes <= 3) {
    badgeClasse = 'badge-trial-expirando';
    badgeTexto = 'TRIAL EXPIRANDO';
    mensagem = `Seu trial expira em ${diasRestantes} dia${diasRestantes === 1 ? '' : 's'}. Cadastre um pagamento para não perder o acesso.`;
  }

  const progresso = trialInfo.trial_inicio && trialInfo.trial_fim
    ? `
      <div class="trial-progresso">
        <div class="trial-progresso-barra"><div class="trial-progresso-preenchido ${corBarra}" style="width:${percentual}%"></div></div>
        <div class="trial-progresso-legenda">
          <span>Início: ${formatarDataCurtaISO(trialInfo.trial_inicio)}</span>
          <span>Término: ${formatarDataCurtaISO(trialInfo.trial_fim)}</span>
        </div>
        <div class="trial-progresso-dias">
          <strong>${trialInfo.trial_ativo ? `${diasRestantes} dias restantes` : 'Trial encerrado'}</strong>
          <span>${trialInfo.trial_dias_utilizados} de 14 dias utilizados</span>
        </div>
      </div>
    `
    : '';

  return `
    <div class="trial-status-bloco">
      <span class="badge ${badgeClasse}">${badgeTexto}</span>
      <p class="modal-texto">${mensagem}</p>
      ${progresso}
      ${cta ? `<p class="modal-texto">${cta}</p>` : ''}
    </div>
  `;
}

async function renderPagamentos() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const dados = await api('/api/pagamentos');
  if (!dados) return;

  const meioLabel = dados.meio_pagamento === 'cartao'
    ? `Cartão •••• ${dados.cartao_final || '----'}`
    : dados.meio_pagamento === 'pix'
      ? 'Pix recorrente'
      : 'Não cadastrado';

  const statusBadge = `<span class="badge ${PAGAMENTOS_STATUS_BADGE[dados.status] || 'badge-status-inativo'}">${PAGAMENTOS_STATUS_LABEL[dados.status] || dados.status}</span>`;

  let html = '<div class="nav-periodo"><strong>Pagamentos</strong></div>';

  if (dados.status === 'trial') {
    const trialInfo = await api('/api/pagamentos/status');
    if (!trialInfo) return;

    html += `
      <div class="financeiro-resumo-card" style="margin-bottom:16px">
        <div class="financeiro-resumo-label">Plano atual</div>
        <div>${dados.plano_nome || 'A definir'}${dados.valor_plano != null ? ` — ${formatarPreco(dados.valor_plano)}/mês após o trial` : ''}</div>
      </div>
      ${renderBlocoTrial(trialInfo)}
      <button class="btn-novo-agendamento" id="btn-cadastrar-pagamento">${trialInfo.trial_ativo ? 'Cadastrar pagamento' : 'Escolher plano'}</button>
    `;
  } else if (!dados.meio_pagamento) {
    html += `
      <p class="modal-texto">Nenhum meio de pagamento cadastrado.</p>
      <button class="btn-novo-agendamento" id="btn-cadastrar-pagamento">Cadastrar forma de pagamento</button>
    `;
  } else {
    html += `
      <div class="financeiro-resumo">
        <div class="financeiro-resumo-card">
          <div class="financeiro-resumo-label">Plano atual</div>
          <div>${dados.plano_nome || '—'}${dados.valor_plano != null ? ` — ${formatarPreco(dados.valor_plano)}` : ''}</div>
        </div>
        <div class="financeiro-resumo-card">
          <div class="financeiro-resumo-label">Meio de pagamento</div>
          <div>${meioLabel}</div>
        </div>
        <div class="financeiro-resumo-card">
          <div class="financeiro-resumo-label">Status</div>
          <div>${statusBadge}</div>
        </div>
      </div>
      <p class="modal-texto">
        Próxima cobrança: ${dados.proxima_cobranca ? `${formatarPreco(dados.proxima_cobranca.valor)} em ${formatarDataCurtaISO(dados.proxima_cobranca.data)}` : 'não disponível'}
      </p>
      <button class="btn-secundario" id="btn-cadastrar-pagamento" style="margin-bottom:16px">Alterar forma de pagamento</button>
      <div class="tabela-wrapper">
        <table class="tabela-tenants">
          <thead><tr><th>Data</th><th>Valor</th><th>Status</th></tr></thead>
          <tbody>
            ${dados.historico.length
              ? dados.historico.map((h) => `<tr><td>${formatarDataCurtaISO(h.data)}</td><td>${formatarPreco(h.valor)}</td><td>${h.status}</td></tr>`).join('')
              : '<tr><td colspan="3">Nenhuma cobrança registrada ainda.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }

  conteudo.innerHTML = html;
  document.getElementById('btn-cadastrar-pagamento').addEventListener('click', () => abrirModalPagamento(dados));
}

function abrirModalPagamento(dadosAtuais) {
  // A Asaas exige CPF/CNPJ do Customer pra emitir cobrança — só pedimos na
  // primeira vez (CA04); se o tenant já tem um cadastrado, não perguntamos
  // de novo ao trocar de meio de pagamento (CA09).
  const cpfCnpjJaCadastrado = !!dadosAtuais.cpf_cnpj;
  // Endereço do titular (exigido só pra cartão, CA04): se já tiver, mostra
  // somente leitura com opção de atualizar; senão, pede no ato.
  const enderecoJaCadastrado = !!(dadosAtuais.endereco_cep && dadosAtuais.endereco_numero);
  const opcoesUF = UF_OPCOES.map((uf) => `<option value="${uf}" ${uf === dadosAtuais.endereco_uf ? 'selected' : ''}>${uf}</option>`).join('');
  const desabilitarEndereco = enderecoJaCadastrado ? 'disabled' : '';

  abrirModal(
    '<h3>Forma de pagamento</h3>',
    `
      <form id="form-pagamento">
        <div class="modal-erro" id="pagamento-erro"></div>
        ${cpfCnpjJaCadastrado ? '' : `
          <label for="pagamento-cpf-cnpj">CPF ou CNPJ *</label>
          <input type="text" id="pagamento-cpf-cnpj" inputmode="numeric" placeholder="Somente números">
        `}

        <label for="pagamento-meio">Forma de pagamento</label>
        <select id="pagamento-meio">
          <option value="pix">Pix recorrente</option>
          <option value="cartao">Cartão de crédito</option>
        </select>

        <div id="campos-cartao" hidden>
          <div class="pagamento-grid-2col">
            <div>
              <label for="cartao-numero">Número do cartão *</label>
              <input type="text" id="cartao-numero" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000">
            </div>
            <div>
              <label for="cartao-nome">Nome impresso *</label>
              <input type="text" id="cartao-nome" autocomplete="cc-name">
            </div>
            <div>
              <label for="cartao-validade">Validade (MM/AAAA) *</label>
              <input type="text" id="cartao-validade" autocomplete="cc-exp" placeholder="MM/AAAA">
            </div>
            <div>
              <label for="cartao-cvv">CVV *</label>
              <input type="text" id="cartao-cvv" autocomplete="cc-csc" placeholder="123">
            </div>
          </div>

          ${enderecoJaCadastrado ? `
            <label class="pagamento-checkbox">
              <input type="checkbox" id="pagamento-atualizar-endereco"> Atualizar endereço de cobrança
            </label>
          ` : ''}
          <div class="pagamento-grid-3col pagamento-secao-endereco" id="campos-endereco">
            <div class="pagamento-span-3">
              <label for="pagamento-logradouro">Logradouro *</label>
              <input type="text" id="pagamento-logradouro" value="${dadosAtuais.endereco_logradouro || ''}" ${desabilitarEndereco}>
            </div>
            <div>
              <label for="pagamento-cep">CEP *</label>
              <input type="text" id="pagamento-cep" inputmode="numeric" placeholder="00000-000" value="${dadosAtuais.endereco_cep || ''}" ${desabilitarEndereco}>
            </div>
            <div>
              <label for="pagamento-numero">Número *</label>
              <input type="text" id="pagamento-numero" value="${dadosAtuais.endereco_numero || ''}" ${desabilitarEndereco}>
            </div>
            <div>
              <label for="pagamento-complemento">Complemento</label>
              <input type="text" id="pagamento-complemento" value="${dadosAtuais.endereco_complemento || ''}" ${desabilitarEndereco}>
            </div>
            <div>
              <label for="pagamento-bairro">Bairro *</label>
              <input type="text" id="pagamento-bairro" value="${dadosAtuais.endereco_bairro || ''}" ${desabilitarEndereco}>
            </div>
            <div>
              <label for="pagamento-cidade">Cidade *</label>
              <input type="text" id="pagamento-cidade" value="${dadosAtuais.endereco_cidade || ''}" ${desabilitarEndereco}>
            </div>
            <div>
              <label for="pagamento-uf">Estado *</label>
              <select id="pagamento-uf" ${desabilitarEndereco}>${opcoesUF}</select>
            </div>
          </div>
        </div>

        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-pagamento">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-pagamento">Confirmar</button>
        </div>
      </form>
    `,
    'modal-card-pagamento'
  );

  document.getElementById('btn-cancelar-pagamento').addEventListener('click', fecharModal);

  const camposCartao = document.getElementById('campos-cartao');
  document.getElementById('pagamento-meio').addEventListener('change', (e) => {
    camposCartao.hidden = e.target.value !== 'cartao';
  });

  const checkboxAtualizarEndereco = document.getElementById('pagamento-atualizar-endereco');
  if (checkboxAtualizarEndereco) {
    checkboxAtualizarEndereco.addEventListener('change', (e) => {
      document.querySelectorAll('#campos-endereco input, #campos-endereco select').forEach((campo) => {
        campo.disabled = !e.target.checked;
      });
    });
  }

  const form = document.getElementById('form-pagamento');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('pagamento-erro');
    erroEl.textContent = '';
    const meio = document.getElementById('pagamento-meio').value;

    const cpfCnpjInput = document.getElementById('pagamento-cpf-cnpj');
    const cpfCnpjLimpo = cpfCnpjInput ? cpfCnpjInput.value.replace(/\D/g, '') : '';
    if (cpfCnpjInput && ![11, 14].includes(cpfCnpjLimpo.length)) {
      erroEl.textContent = 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.';
      return;
    }

    // Só manda endereço se o tenant nunca cadastrou um, ou se marcou a
    // opção de atualizar (CA09-like — não pede de novo sem necessidade).
    const enviarEndereco = meio === 'cartao' && (!enderecoJaCadastrado || (checkboxAtualizarEndereco && checkboxAtualizarEndereco.checked));
    if (enviarEndereco) {
      const camposObrigatorios = ['pagamento-cep', 'pagamento-numero', 'pagamento-logradouro', 'pagamento-bairro', 'pagamento-cidade'];
      const algumVazio = camposObrigatorios.some((id) => !document.getElementById(id).value.trim());
      if (algumVazio) {
        erroEl.textContent = 'Preencha todos os campos do endereço.';
        return;
      }
    }

    const btn = document.getElementById('btn-salvar-pagamento');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    // Sem tokenização client-side na Asaas (diferente de outros gateways):
    // o número/validade/CVV vão pro próprio backend do Kyvvo via HTTPS, que
    // tokeniza server-side com a Asaas — nunca armazenados nem logados.
    let payload = { meio };
    if (cpfCnpjInput) payload.cpf_cnpj = cpfCnpjLimpo;
    if (meio === 'cartao') {
      const [mes, ano] = document.getElementById('cartao-validade').value.split('/');
      payload.cartao_numero = document.getElementById('cartao-numero').value.replace(/\D/g, '');
      payload.cartao_nome = document.getElementById('cartao-nome').value;
      payload.cartao_validade_mes = (mes || '').trim();
      payload.cartao_validade_ano = (ano || '').trim();
      payload.cartao_cvv = document.getElementById('cartao-cvv').value;
    }
    if (enviarEndereco) {
      payload.endereco = {
        cep: document.getElementById('pagamento-cep').value.replace(/\D/g, ''),
        logradouro: document.getElementById('pagamento-logradouro').value,
        numero: document.getElementById('pagamento-numero').value,
        complemento: document.getElementById('pagamento-complemento').value,
        bairro: document.getElementById('pagamento-bairro').value,
        cidade: document.getElementById('pagamento-cidade').value,
        uf: document.getElementById('pagamento-uf').value,
      };
    }

    const resultado = await api('/api/pagamentos/cadastrar', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Pagamento cadastrado com sucesso! Sua assinatura está ativa.', 'sucesso');
      renderPagamentos();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao cadastrar pagamento.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}

async function render() {
  if (menuAtual === 'configuracao') return renderConfiguracao();
  if (menuAtual === 'perfil') return renderPerfil();
  if (menuAtual === 'pagamentos') return renderPagamentos();
  if (menuAtual === 'servicos') return renderServicos();
  if (menuAtual === 'profissionais') return renderProfissionais();
  if (menuAtual === 'modulo:financeiro') return renderFinanceiro();
  if (menuAtual.startsWith('modulo:')) return renderModuloEmBreve();

  if (abaAtual === 'dia') return renderDia();
  if (abaAtual === 'semana') return renderSemana();
  if (abaAtual === 'mes') return renderMes();
}

// ---------- Serviços (US17/ST17.3) ----------
let servicosAtuais = [];

function formatarPreco(preco) {
  return preco != null ? `R$ ${Number(preco).toFixed(2).replace('.', ',')}` : 'sem preço definido';
}

function renderServicoItem(s) {
  return `
    <div class="agendamento-item" data-id="${s.id}">
      <div class="agendamento-linha-principal" data-acoes-toggle="${s.id}">
        <div>
          <div class="agendamento-hora">${s.nome}</div>
          <div class="agendamento-detalhe">${s.duracao_minutos}min · ${formatarPreco(s.preco)}</div>
        </div>
        <button class="btn-acoes" aria-label="Ações">⋮</button>
      </div>
      <div class="menu-acoes" id="menu-acoes-${s.id}">
        <button data-acao-servico="editar" data-id="${s.id}">Editar</button>
        <button data-acao-servico="excluir" data-id="${s.id}" class="acao-perigo">Excluir</button>
      </div>
    </div>
  `;
}

async function renderServicos() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api('/api/servicos');
  if (!data) return;
  servicosAtuais = data.servicos;

  let html = `
    <div class="nav-periodo">
      <strong>Serviços</strong>
      <button class="btn-novo-agendamento" id="btn-novo-servico">+ Novo serviço</button>
    </div>
  `;
  html += servicosAtuais.length
    ? servicosAtuais.map(renderServicoItem).join('')
    : '<div class="vazio">Nenhum serviço cadastrado ainda.</div>';

  conteudo.innerHTML = html;
  document.getElementById('btn-novo-servico').addEventListener('click', () => abrirModalServico(null));
}

function abrirModalServico(servico) {
  const editando = !!servico;
  abrirModal(
    `<h3>${editando ? 'Editar serviço' : 'Novo serviço'}</h3>`,
    `
      <form id="form-servico">
        <div class="modal-erro" id="servico-erro"></div>
        <label for="servico-nome">Nome *</label>
        <input type="text" id="servico-nome" data-obrigatorio value="${editando ? servico.nome : ''}">
        <label for="servico-duracao">Duração (minutos) *</label>
        <input type="number" id="servico-duracao" data-obrigatorio min="1" value="${editando ? servico.duracao_minutos : ''}">
        <label for="servico-preco">Preço em R$ (opcional)</label>
        <input type="number" id="servico-preco" min="0" step="0.01" value="${editando && servico.preco != null ? servico.preco : ''}">
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-servico">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-servico">${editando ? 'Salvar' : 'Criar'}</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-servico').addEventListener('click', fecharModal);

  const form = document.getElementById('form-servico');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('servico-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-servico');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const precoValor = document.getElementById('servico-preco').value;
    const payload = {
      nome: document.getElementById('servico-nome').value.trim(),
      duracao_minutos: parseInt(document.getElementById('servico-duracao').value, 10),
      preco: precoValor ? parseFloat(precoValor) : null,
    };

    const resultado = await api(editando ? `/api/servicos/${servico.id}` : '/api/servicos', {
      method: editando ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(editando ? 'Serviço atualizado com sucesso.' : 'Serviço criado com sucesso.', 'sucesso');
      renderServicos();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar serviço.';
      btn.disabled = false;
      btn.textContent = editando ? 'Salvar' : 'Criar';
    }
  });
}

function abrirModalExcluirServico(servico) {
  abrirModal(
    '<h3>Excluir serviço</h3>',
    `
      <p class="modal-texto">Tem certeza que deseja excluir o serviço <strong>${servico.nome}</strong>? Essa ação não pode ser desfeita.</p>
      <div class="modal-erro" id="excluir-servico-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-excluir-servico">Voltar</button>
        <button class="btn-perigo" id="btn-confirmar-excluir-servico">Excluir</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-excluir-servico').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir-servico').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-servico');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/servicos/${servico.id}`, { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Serviço excluído com sucesso.', 'sucesso');
      renderServicos();
    } else {
      document.getElementById('excluir-servico-erro').textContent = (resultado && resultado.error) || 'Erro ao excluir serviço.';
      btn.disabled = false;
      btn.textContent = 'Excluir';
    }
  });
}

// ---------- Profissionais (US17/ST17.4) ----------
let profissionaisAtuais = [];

function renderProfissionalItem(p) {
  const qtd = (p.servicos || []).length;
  return `
    <div class="agendamento-item" data-id="${p.id}">
      <div class="agendamento-linha-principal" data-acoes-toggle="${p.id}">
        <div>
          <div class="agendamento-hora">${p.nome}</div>
          <div class="agendamento-detalhe">${qtd} serviço${qtd === 1 ? '' : 's'} atendido${qtd === 1 ? '' : 's'}</div>
        </div>
        <button class="btn-acoes" aria-label="Ações">⋮</button>
      </div>
      <div class="menu-acoes" id="menu-acoes-${p.id}">
        <button data-acao-profissional="editar" data-id="${p.id}">Editar</button>
        <button data-acao-profissional="excluir" data-id="${p.id}" class="acao-perigo">Excluir</button>
      </div>
    </div>
  `;
}

async function renderProfissionais() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api('/api/profissionais');
  if (!data) return;
  profissionaisAtuais = data.profissionais;

  let html = `
    <div class="nav-periodo">
      <strong>Profissionais</strong>
      <button class="btn-novo-agendamento" id="btn-novo-profissional">+ Novo profissional</button>
    </div>
  `;
  html += profissionaisAtuais.length
    ? profissionaisAtuais.map(renderProfissionalItem).join('')
    : '<div class="vazio">Nenhum profissional cadastrado ainda.</div>';

  conteudo.innerHTML = html;
  document.getElementById('btn-novo-profissional').addEventListener('click', () => abrirModalProfissional(null));
}

async function abrirModalProfissional(profissional) {
  const editando = !!profissional;
  const listaServicosResultado = await api('/api/servicos');
  const listaServicos = (listaServicosResultado && listaServicosResultado.servicos) || [];
  const servicosVinculados = editando ? profissional.servicos || [] : [];

  const checkboxesServicos = listaServicos.length
    ? listaServicos
        .map(
          (s) => `
        <label class="dia-checkbox">
          <input type="checkbox" value="${s.id}" ${servicosVinculados.includes(s.id) ? 'checked' : ''}>
          ${s.nome}
        </label>
      `
        )
        .join('')
    : '<div class="modal-texto">Nenhum serviço cadastrado ainda — cadastre um serviço primeiro.</div>';

  abrirModal(
    `<h3>${editando ? 'Editar profissional' : 'Novo profissional'}</h3>`,
    `
      <form id="form-profissional">
        <div class="modal-erro" id="profissional-erro"></div>
        <label for="profissional-nome">Nome *</label>
        <input type="text" id="profissional-nome" data-obrigatorio value="${editando ? profissional.nome : ''}">
        <label>Serviços atendidos</label>
        <div class="dias-grid" id="profissional-servicos">${checkboxesServicos}</div>
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="btn-cancelar-profissional">Cancelar</button>
          <button type="submit" class="btn-primario" id="btn-salvar-profissional">${editando ? 'Salvar' : 'Criar'}</button>
        </div>
      </form>
    `
  );

  document.getElementById('btn-cancelar-profissional').addEventListener('click', fecharModal);

  const form = document.getElementById('form-profissional');
  form.querySelectorAll('[data-obrigatorio]').forEach((campo) => {
    campo.addEventListener('input', () => campo.classList.remove('campo-invalido'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erroEl = document.getElementById('profissional-erro');
    erroEl.textContent = '';
    const invalido = validarObrigatorios(form);
    if (invalido) {
      erroEl.textContent = 'Preencha os campos obrigatórios destacados em vermelho.';
      invalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-profissional');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const servicosSelecionados = Array.from(document.querySelectorAll('#profissional-servicos input:checked')).map((el) => el.value);
    const payload = {
      nome: document.getElementById('profissional-nome').value.trim(),
      servicos: servicosSelecionados,
    };

    const resultado = await api(editando ? `/api/profissionais/${profissional.id}` : '/api/profissionais', {
      method: editando ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast(editando ? 'Profissional atualizado com sucesso.' : 'Profissional criado com sucesso.', 'sucesso');
      renderProfissionais();
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao salvar profissional.';
      btn.disabled = false;
      btn.textContent = editando ? 'Salvar' : 'Criar';
    }
  });
}

function abrirModalExcluirProfissional(profissional) {
  abrirModal(
    '<h3>Excluir profissional</h3>',
    `
      <p class="modal-texto">Tem certeza que deseja excluir <strong>${profissional.nome}</strong>? Essa ação não pode ser desfeita.</p>
      <div class="modal-erro" id="excluir-profissional-erro"></div>
      <div class="modal-acoes">
        <button class="btn-secundario" id="btn-voltar-excluir-profissional">Voltar</button>
        <button class="btn-perigo" id="btn-confirmar-excluir-profissional">Excluir</button>
      </div>
    `
  );

  document.getElementById('btn-voltar-excluir-profissional').addEventListener('click', fecharModal);
  document.getElementById('btn-confirmar-excluir-profissional').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirmar-excluir-profissional');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api(`/api/profissionais/${profissional.id}`, { method: 'DELETE' });

    if (resultado && !resultado.error) {
      fecharModal();
      mostrarToast('Profissional excluído com sucesso.', 'sucesso');
      renderProfissionais();
    } else {
      document.getElementById('excluir-profissional-erro').textContent = (resultado && resultado.error) || 'Erro ao excluir profissional.';
      btn.disabled = false;
      btn.textContent = 'Excluir';
    }
  });
}

function renderModuloEmBreve() {
  conteudo.innerHTML = '<div class="vazio">🚧 Em breve — este módulo ainda está em desenvolvimento.</div>';
}

async function renderDia() {
  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=dia&data=${iso}`);
  if (!data) return;

  const dataLabel = dataRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  // US02.5 — nome do dia da semana logo abaixo da data, mesmo padrão que a
  // view Semana já usa nos cabeçalhos de cada dia.
  let html = `
    <div class="nav-periodo">
      <button data-nav="-1">← Anterior</button>
      <div class="nav-periodo-data">
        <strong>${dataLabel}</strong>
        <div class="nav-periodo-dia-semana">${nomeDiaSemana(dataRef)}</div>
      </div>
      <button data-nav="1">Próximo →</button>
    </div>
  `;

  agendamentosAtuais = data.agendamentos;

  if (data.agendamentos.length === 0) {
    html += '<div class="vazio">Nenhum agendamento nesse dia.</div>';
  } else {
    for (const ag of data.agendamentos) {
      html += renderAgendamentoItem(ag);
    }
  }

  conteudo.innerHTML = html;
  conteudo.querySelector('[data-nav="-1"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() - 1);
    renderDia();
  });
  conteudo.querySelector('[data-nav="1"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() + 1);
    renderDia();
  });
}

async function renderSemana() {
  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=semana&data=${iso}`);
  if (!data) return;

  agendamentosAtuais = data.agendamentos;

  const porDia = {};
  for (const ag of data.agendamentos) {
    const diaISO = ag.data_hora.slice(0, 10);
    if (!porDia[diaISO]) porDia[diaISO] = [];
    porDia[diaISO].push(ag);
  }

  let html = `
    <div class="nav-periodo">
      <button data-nav="-7">← Semana anterior</button>
      <strong>Semana de ${dataRef.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</strong>
      <button data-nav="7">Próxima semana →</button>
    </div>
  `;

const diasFuncionamento = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  const diasOrdenados = Object.keys(porDia)
    .filter((diaISO) => diasFuncionamento.includes(new Date(diaISO + 'T12:00:00').getDay()))
    .sort();
  if (diasOrdenados.length === 0) {
    html += '<div class="vazio">Nenhum agendamento nos dias de funcionamento dessa semana.</div>';
  } else {
    for (const diaISO of diasOrdenados) {
      const d = new Date(diaISO + 'T12:00:00');
      html += `<div class="dia-header">${nomeDiaSemana(d)}, ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })}</div>`;
      for (const ag of porDia[diaISO]) {
        html += renderAgendamentoItem(ag);
      }
    }
  }

  conteudo.innerHTML = html;
  conteudo.querySelector('[data-nav="-7"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() - 7);
    renderSemana();
  });
  conteudo.querySelector('[data-nav="7"]').addEventListener('click', () => {
    dataRef.setDate(dataRef.getDate() + 7);
    renderSemana();
  });
}

async function renderMes() {
  const mesISO = formatarDataISO(dataRef).slice(0, 7);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=mes&data=${mesISO}`);
  if (!data) return;

  // US02.6 — antes mostrava só a contagem de agendamentos por dia; agora
  // agrupa por dia e lista horário-duração de cada um, empilhados na célula.
  const porDia = {};
  for (const ag of data.agendamentos) {
    const diaISO = ag.data_hora.slice(0, 10);
    if (!porDia[diaISO]) porDia[diaISO] = [];
    porDia[diaISO].push(ag);
  }

  const ano = dataRef.getFullYear();
  const mes = dataRef.getMonth();
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const offsetSemana = primeiroDia.getDay();

  const mesLabel = dataRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  let html = `
    <div class="nav-periodo">
      <button data-nav="-1">← Mês anterior</button>
      <strong>${mesLabel}</strong>
      <button data-nav="1">Próximo mês →</button>
    </div>
    <div class="calendario">
  `;

  for (let i = 0; i < offsetSemana; i++) {
    html += '<div class="dia-cel vazio-cel"></div>';
  }
  const diasFuncionamentoMes = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  for (let dia = 1; dia <= ultimoDia.getDate(); dia++) {
    const diaISO = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const agsDoDia = porDia[diaISO] || [];
    const diaSemana = new Date(ano, mes, dia).getDay();
    const fechado = !diasFuncionamentoMes.includes(diaSemana);
    const listaAgendamentos = agsDoDia.length
      ? `<div class="dia-cel-agendamentos">${agsDoDia
          .map(
            (ag) =>
              `<div class="dia-cel-ag${ag.status === 'cancelado' ? ' dia-cel-ag-cancelado' : ''}">${formatarHora(ag.data_hora)}-${ag.duracao_minutos}min</div>`
          )
          .join('')}</div>`
      : '';
    html += `
      <div class="dia-cel${fechado ? ' dia-cel-fechado' : ''}">
        <div class="num">${dia}</div>
        ${listaAgendamentos}
      </div>
    `;
  }

  html += '</div>';
  conteudo.innerHTML = html;
  conteudo.querySelector('[data-nav="-1"]').addEventListener('click', () => {
    dataRef.setMonth(dataRef.getMonth() - 1);
    renderMes();
  });
  conteudo.querySelector('[data-nav="1"]').addEventListener('click', () => {
    dataRef.setMonth(dataRef.getMonth() + 1);
    renderMes();
  });
}

// ---------- Perfil (US33) ----------
const UF_OPCOES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
  'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

// Máscara de telefone brasileiro (fixo ou celular) enquanto o usuário digita —
// mesmo raciocínio de exibição do WhatsApp em cadastro.html, mas aqui aplicado
// ao vivo no campo em vez de só no placeholder.
function formatarTelefoneMascara(valor) {
  const digitos = (valor || '').replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 2) return digitos ? `(${digitos}` : '';
  const ddd = digitos.slice(0, 2);
  const resto = digitos.slice(2);
  if (digitos.length <= 10) {
    return resto.length > 4 ? `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}` : `(${ddd}) ${resto}`;
  }
  return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`;
}

async function renderPerfil() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const perfil = await api('/api/perfil');
  if (!perfil) return;

  const opcoesUF = UF_OPCOES.map((uf) => `<option value="${uf}" ${uf === perfil.endereco_uf ? 'selected' : ''}>${uf}</option>`).join('');

  conteudo.innerHTML = `
    <form class="perfil-form" id="form-perfil" novalidate>
      <label for="nome_responsavel">Nome do Responsável</label>
      <input type="text" id="nome_responsavel" value="${perfil.nome_responsavel || ''}">
      <div class="field-error" id="erro-nome_responsavel"></div>

      <label for="nome_segmento">Nome do Segmento</label>
      <input type="text" id="nome_segmento" value="${perfil.nome_segmento || ''}">
      <div class="field-error" id="erro-nome_segmento"></div>

      <label for="telefone">Telefone</label>
      <input type="tel" id="telefone" placeholder="(11) 99999-9999" value="${formatarTelefoneMascara(perfil.telefone)}">
      <div class="field-error" id="erro-telefone"></div>

      <label>Endereço</label>
      <div class="endereco-grid">
        <div>
          <label for="endereco-cep" class="endereco-sublabel">CEP</label>
          <input type="text" id="endereco-cep" placeholder="00000-000" value="${perfil.endereco_cep || ''}">
        </div>
        <div>
          <label for="endereco-numero" class="endereco-sublabel">Número</label>
          <input type="text" id="endereco-numero" value="${perfil.endereco_numero || ''}">
        </div>
      </div>
      <label for="endereco-logradouro" class="endereco-sublabel">Rua / Logradouro</label>
      <input type="text" id="endereco-logradouro" value="${perfil.endereco_logradouro || ''}">
      <label for="endereco-complemento" class="endereco-sublabel">Complemento (opcional)</label>
      <input type="text" id="endereco-complemento" value="${perfil.endereco_complemento || ''}">
      <label for="endereco-bairro" class="endereco-sublabel">Bairro</label>
      <input type="text" id="endereco-bairro" value="${perfil.endereco_bairro || ''}">
      <label for="endereco-cidade" class="endereco-sublabel">Cidade</label>
      <input type="text" id="endereco-cidade" value="${perfil.endereco_cidade || ''}">
      <label for="endereco-uf" class="endereco-sublabel">Estado</label>
      <select id="endereco-uf">${opcoesUF}</select>
      <div class="field-error" id="erro-endereco"></div>

      <label>E-mail</label>
      <input type="text" value="${perfil.email || ''}" disabled>
      <label>WhatsApp</label>
      <input type="text" value="${formatarTelefoneMascara(perfil.whatsapp)}" disabled>
      <label>Plano atual</label>
      <div class="modal-texto">${perfil.plano_nome} — <a href="#" id="link-perfil-pagamentos">ver aba de Pagamentos</a></div>

      <button type="submit" id="btn-salvar-perfil">Salvar alterações</button>
    </form>
  `;

  document.getElementById('link-perfil-pagamentos').addEventListener('click', (e) => {
    e.preventDefault();
    // A aba de Pagamentos (US32) pode ainda não existir nesta versão do
    // portal — não navega (em vez de quebrar) se o item de menu não existir.
    const itemPagamentos = document.querySelector('.menu-item[data-menu="pagamentos"]');
    if (itemPagamentos) ativarMenuItem(itemPagamentos);
  });

  const telefoneInput = document.getElementById('telefone');
  telefoneInput.addEventListener('input', () => {
    telefoneInput.value = formatarTelefoneMascara(telefoneInput.value);
  });

  // CA04 — ao sair do campo CEP, autopreenche o resto do endereço via ViaCEP.
  document.getElementById('endereco-cep').addEventListener('blur', async () => {
    const cep = document.getElementById('endereco-cep').value.replace(/\D/g, '');
    if (cep.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const dados = await res.json();
      if (dados.erro) {
        document.getElementById('erro-endereco').textContent = 'CEP não encontrado. Preencha o endereço manualmente.';
        return;
      }
      document.getElementById('erro-endereco').textContent = '';
      document.getElementById('endereco-logradouro').value = dados.logradouro || '';
      document.getElementById('endereco-bairro').value = dados.bairro || '';
      document.getElementById('endereco-cidade').value = dados.localidade || '';
      document.getElementById('endereco-uf').value = dados.uf || '';
    } catch (erro) {
      // Falha de rede na consulta ao ViaCEP: deixa o usuário preencher os
      // subcampos manualmente em vez de bloquear o formulário.
    }
  });

  document.getElementById('form-perfil').addEventListener('submit', async (e) => {
    e.preventDefault();

    const nomeResponsavel = document.getElementById('nome_responsavel').value;
    const nomeSegmento = document.getElementById('nome_segmento').value;
    const telefone = document.getElementById('telefone').value;
    const cep = document.getElementById('endereco-cep').value;
    const logradouro = document.getElementById('endereco-logradouro').value;
    const numero = document.getElementById('endereco-numero').value;
    const complemento = document.getElementById('endereco-complemento').value;
    const bairro = document.getElementById('endereco-bairro').value;
    const cidade = document.getElementById('endereco-cidade').value;
    const uf = document.getElementById('endereco-uf').value;

    const erros = {
      nome_responsavel: nomeResponsavel.trim().length >= 2 ? '' : 'Informe o nome do responsável.',
      nome_segmento: nomeSegmento.trim().length >= 2 ? '' : 'Informe o nome do seu negócio.',
      telefone: telefone.replace(/\D/g, '').length >= 10 ? '' : 'Informe um telefone válido com DDD.',
      endereco:
        cep.replace(/\D/g, '').length === 8 && logradouro.trim() && numero.trim() && bairro.trim() && cidade.trim() && uf
          ? ''
          : 'Preencha todos os campos do endereço.',
    };

    let primeiroInvalido = null;
    ['nome_responsavel', 'telefone'].forEach((campo) => {
      document.getElementById(campo).classList.toggle('invalid', !!erros[campo]);
      document.getElementById('erro-' + campo).textContent = erros[campo];
      if (erros[campo] && !primeiroInvalido) primeiroInvalido = document.getElementById(campo);
    });
    document.getElementById('nome_segmento').classList.toggle('invalid', !!erros.nome_segmento);
    document.getElementById('erro-nome_segmento').textContent = erros.nome_segmento;
    if (erros.nome_segmento && !primeiroInvalido) primeiroInvalido = document.getElementById('nome_segmento');
    document.getElementById('erro-endereco').textContent = erros.endereco;
    if (erros.endereco && !primeiroInvalido) primeiroInvalido = document.getElementById('endereco-cep');

    if (Object.values(erros).some(Boolean)) {
      if (primeiroInvalido) primeiroInvalido.focus();
      return;
    }

    const btn = document.getElementById('btn-salvar-perfil');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const resultado = await api('/api/perfil', {
      method: 'PATCH',
      body: JSON.stringify({
        nome_responsavel: nomeResponsavel,
        nome_segmento: nomeSegmento,
        telefone,
        endereco: { cep, logradouro, numero, complemento, bairro, cidade, uf },
      }),
    });

    if (resultado && !resultado.error) {
      mostrarToast('Perfil atualizado com sucesso.', 'sucesso');
      renderPerfil();
    } else {
      mostrarToast((resultado && resultado.error) || 'Erro ao salvar. Tente novamente.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Salvar alterações';
    }
  });
}

async function renderConfiguracao() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  await carregarConfiguracao();
  const dias = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  const formato = configuracao.formato_hora || '24h';
  // "time" do Postgres vem com segundos ("08:00:00"); <input type="time">
  // espera "HH:MM".
  const horarioAbertura = (configuracao.horario_abertura || '08:00').slice(0, 5);
  const horarioFechamento = (configuracao.horario_fechamento || '20:00').slice(0, 5);

  const checkboxesDias = NOMES_DIAS.map((nome, idx) => `
    <label class="dia-checkbox">
      <input type="checkbox" value="${idx}" ${dias.includes(idx) ? 'checked' : ''}>
      ${nome}
    </label>
  `).join('');

  conteudo.innerHTML = `
    <form class="perfil-form" id="form-config">
      <label>Dias em que ${infoSegmento(configuracao.segmento).dias} funciona (aparecem na agenda)</label>
      <div class="dias-grid">${checkboxesDias}</div>

      <label>Formato de hora</label>
      <div class="formato-hora-opcoes">
        <label class="dia-checkbox">
          <input type="radio" name="formato" value="24h" ${formato === '24h' ? 'checked' : ''}>
          24h (ex: 14:00)
        </label>
        <label class="dia-checkbox">
          <input type="radio" name="formato" value="12h" ${formato === '12h' ? 'checked' : ''}>
          AM/PM (ex: 2:00 PM)
        </label>
      </div>

      <label>Horário de funcionamento</label>
      <div class="formato-hora-opcoes">
        <div>
          <label for="config-horario-abertura">Abertura</label>
          <input type="time" id="config-horario-abertura" value="${horarioAbertura}">
        </div>
        <div>
          <label for="config-horario-fechamento">Fechamento</label>
          <input type="time" id="config-horario-fechamento" value="${horarioFechamento}">
        </div>
      </div>
      <div class="modal-texto">Agendamentos só podem ser feitos dentro desse intervalo.</div>

      <button type="submit">Salvar</button>
      <div class="erro" id="config-msg"></div>
    </form>
  `;

  document.getElementById('form-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('config-msg');
    msg.style.color = '';
    msg.textContent = 'Salvando...';

    const diasFuncionamento = Array.from(document.querySelectorAll('.dias-grid input:checked')).map((el) => parseInt(el.value, 10));
    const formatoHora = document.querySelector('input[name="formato"]:checked').value;
    const horarioAbertura = document.getElementById('config-horario-abertura').value;
    const horarioFechamento = document.getElementById('config-horario-fechamento').value;

    const resultado = await api('/api/configuracao', {
      method: 'PATCH',
      body: JSON.stringify({ diasFuncionamento, formatoHora, horarioAbertura, horarioFechamento }),
    });

    if (resultado && !resultado.error) {
      configuracao = resultado;
      msg.style.color = '#4ade80';
      msg.textContent = 'Salvo com sucesso!';
    } else {
      msg.style.color = '#ff6b6b';
      msg.textContent = (resultado && resultado.error) || 'Erro ao salvar configuração.';
    }
  });
}

carregarConfiguracao().then(render);
carregarModulosNoMenu();
