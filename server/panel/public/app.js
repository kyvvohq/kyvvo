const token = localStorage.getItem('kyvvo_token');
if (!token) {
  window.location.href = '/login.html';
}

document.getElementById('btn-sair').addEventListener('click', () => {
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
const menuItems = document.querySelectorAll('.menu-item');
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

menuItems.forEach((item) => {
  item.addEventListener('click', () => {
    menuItems.forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
    menuAtual = item.dataset.menu;
    subtabsEl.style.display = menuAtual === 'agendamento' ? 'flex' : 'none';
    dataRef = new Date();
    render();
  });
});

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

const NOMES_DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

async function render() {
  if (menuAtual === 'configuracao') return renderConfiguracao();
  if (menuAtual === 'perfil') return renderPerfil();

  if (abaAtual === 'dia') return renderDia();
  if (abaAtual === 'semana') return renderSemana();
  if (abaAtual === 'mes') return renderMes();
}

async function renderDia() {
  const iso = formatarDataISO(dataRef);
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  const data = await api(`/api/agendamentos?view=dia&data=${iso}`);
  if (!data) return;

  const dataLabel = dataRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

  let html = `
    <div class="nav-periodo">
      <button data-nav="-1">← Anterior</button>
      <strong>${dataLabel}</strong>
      <button data-nav="1">Próximo →</button>
    </div>
  `;

  if (data.agendamentos.length === 0) {
    html += '<div class="vazio">Nenhum agendamento nesse dia.</div>';
  } else {
    for (const ag of data.agendamentos) {
      html += `
        <div class="agendamento-item">
          <div class="agendamento-hora">${formatarHora(ag.data_hora)} — ${ag.servico}</div>
          <div class="agendamento-detalhe">${ag.cliente} · ${ag.profissional} · ${ag.duracao_minutos}min</div>
        </div>
      `;
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
        html += `
          <div class="agendamento-item">
            <div class="agendamento-hora">${formatarHora(ag.data_hora)} — ${ag.servico}</div>
            <div class="agendamento-detalhe">${ag.cliente} · ${ag.profissional}</div>
          </div>
        `;
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

  const contagem = {};
  for (const item of data.contagemPorDia) {
    contagem[item.dia.slice(0, 10)] = item.total;
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
    const total = contagem[diaISO];
    const diaSemana = new Date(ano, mes, dia).getDay();
    const fechado = !diasFuncionamentoMes.includes(diaSemana);
    html += `
      <div class="dia-cel${fechado ? ' dia-cel-fechado' : ''}">
        <div class="num">${dia}</div>
        ${total ? `<div class="count">${total}</div>` : ''}
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

  conteudo.innerHTML = `
    <form class="perfil-form" id="form-perfil">
      <label for="nome">Nome do salão</label>
      <input type="text" id="nome" value="${perfil.nome || ''}">
      <label for="telefone">Telefone</label>
      <input type="text" id="telefone" value="${perfil.telefone || ''}">
      <label for="endereco">Endereço</label>
      <input type="text" id="endereco" value="${perfil.endereco || ''}">
      <button type="submit">Salvar</button>
      <div class="erro" id="perfil-msg"></div>
    </form>
  `;

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
      }),
    });
    if (resultado) {
      msg.style.color = '#4ade80';
      msg.textContent = 'Salvo com sucesso!';
    }
  });
}

async function renderConfiguracao() {
  conteudo.innerHTML = '<div class="vazio">Carregando...</div>';
  await carregarConfiguracao();
  const dias = configuracao.dias_funcionamento || [1, 2, 3, 4, 5, 6];
  const formato = configuracao.formato_hora || '24h';

  const checkboxesDias = NOMES_DIAS.map((nome, idx) => `
    <label class="dia-checkbox">
      <input type="checkbox" value="${idx}" ${dias.includes(idx) ? 'checked' : ''}>
      ${nome}
    </label>
  `).join('');

  conteudo.innerHTML = `
    <form class="perfil-form" id="form-config">
      <label>Dias em que o salão funciona (aparecem na agenda)</label>
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

    const resultado = await api('/api/configuracao', {
      method: 'PATCH',
      body: JSON.stringify({ diasFuncionamento, formatoHora }),
    });

    if (resultado) {
      configuracao = resultado;
      msg.style.color = '#4ade80';
      msg.textContent = 'Salvo com sucesso!';
    }
  });
}

carregarConfiguracao().then(render);
