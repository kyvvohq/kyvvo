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
  window.location.href = '/login.html';
});

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

function abrirModal(tituloHtml, conteudoHtml) {
  fecharModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
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
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.agendamento-item')) {
    document.querySelectorAll('.menu-acoes.aberto').forEach((m) => m.classList.remove('aberto'));
  }
});

const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// Segmento de negócio do tenant — só adapta terminologia da UI (label do
// campo "nome" no Perfil, texto de "dias de funcionamento" na Configuração),
// sem mudar comportamento. Mesma lista fixa validada no backend.
const SEGMENTOS = {
  salao_beleza: { rotulo: 'Salão de beleza', nomeCampo: 'Nome do salão', dias: 'o salão' },
  petshop: { rotulo: 'Pet Shop', nomeCampo: 'Nome do petshop', dias: 'o petshop' },
  psicologia: { rotulo: 'Psicólogo(a)', nomeCampo: 'Nome da clínica', dias: 'o consultório' },
  fisioterapia: { rotulo: 'Fisioterapia', nomeCampo: 'Nome da clínica', dias: 'a clínica' },
  pilates: { rotulo: 'Pilates', nomeCampo: 'Nome do studio', dias: 'o studio' },
  outro: { rotulo: 'Outro', nomeCampo: 'Nome do negócio', dias: 'o negócio' },
};
function infoSegmento(segmento) {
  return SEGMENTOS[segmento] || SEGMENTOS.outro;
}

async function render() {
  if (menuAtual === 'configuracao') return renderConfiguracao();
  if (menuAtual === 'perfil') return renderPerfil();
  if (menuAtual.startsWith('modulo:')) return renderModuloEmBreve();

  if (abaAtual === 'dia') return renderDia();
  if (abaAtual === 'semana') return renderSemana();
  if (abaAtual === 'mes') return renderMes();
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

async function renderPerfil() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const perfil = await api('/api/perfil');
  if (!perfil) return;

  const segmentoAtual = perfil.segmento || 'salao_beleza';
  const opcoesSegmento = Object.entries(SEGMENTOS)
    .map(([key, s]) => `<option value="${key}" ${key === segmentoAtual ? 'selected' : ''}>${s.rotulo}</option>`)
    .join('');

  conteudo.innerHTML = `
    <form class="perfil-form" id="form-perfil">
      <label for="segmento">Segmento do negócio</label>
      <select id="segmento">${opcoesSegmento}</select>
      <label for="nome" id="nome-label">${infoSegmento(segmentoAtual).nomeCampo}</label>
      <input type="text" id="nome" value="${perfil.nome || ''}">
      <label for="telefone">Telefone</label>
      <input type="text" id="telefone" value="${perfil.telefone || ''}">
      <label for="endereco">Endereço</label>
      <input type="text" id="endereco" value="${perfil.endereco || ''}">
      <button type="submit">Salvar</button>
      <div class="erro" id="perfil-msg"></div>
    </form>
  `;

  // Troca o label do campo "nome" ao mudar o segmento no select, sem precisar
  // salvar/recarregar pra ver o rótulo certo.
  document.getElementById('segmento').addEventListener('change', (e) => {
    document.getElementById('nome-label').textContent = infoSegmento(e.target.value).nomeCampo;
  });

  document.getElementById('form-perfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('perfil-msg');
    msg.style.color = '';
    msg.textContent = 'Salvando...';
    const resultado = await api('/api/perfil', {
      method: 'PATCH',
      body: JSON.stringify({
        nome: document.getElementById('nome').value,
        telefone: document.getElementById('telefone').value,
        endereco: document.getElementById('endereco').value,
        segmento: document.getElementById('segmento').value,
      }),
    });
    if (resultado && !resultado.error) {
      msg.style.color = '#4ade80';
      msg.textContent = 'Salvo com sucesso!';
    } else {
      msg.style.color = '#ff6b6b';
      msg.textContent = (resultado && resultado.error) || 'Erro ao salvar perfil.';
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
