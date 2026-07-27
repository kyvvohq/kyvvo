// Formulário de forma de pagamento (US32/US37) — extraído de app.js (US52)
// pra ser reaproveitado também pela tela de bloqueio pós-trial
// (bloqueio.html), que não carrega o app.js inteiro (aquele script assume
// elementos do painel completo — menu, abas de agenda etc. — que não existem
// nessa tela standalone). Depende apenas de `api()` e `mostrarToast()`
// estarem definidas globalmente por quem incluir este arquivo.

const UF_OPCOES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
  'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

function formatarPreco(preco) {
  return preco != null ? `R$ ${Number(preco).toFixed(2).replace('.', ',')}` : 'sem preço definido';
}

function formatarDataCurtaISO(dataISO) {
  if (!dataISO) return '—';
  // dueDate/data vêm como "YYYY-MM-DD" (sem hora) tanto do banco quanto da
  // Asaas — new Date("YYYY-MM-DD") interpreta como UTC meia-noite, então
  // formata os componentes direto da string em vez de usar o Date local.
  const [ano, mes, dia] = dataISO.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

// Formulário de forma de pagamento (US32/US37) — HTML puro reaproveitado
// tanto no modal de "Cadastrar/Alterar forma de pagamento" (trial, primeira
// vez, reativação) quanto no collapse "Detalhes" da assinatura já ativa
// (US35 redesign) quanto na tela de bloqueio pós-trial (US52).
// `comBotaoCancelar` só existe no uso em modal (fechar sem salvar); o
// collapse e a tela de bloqueio não precisam.
function htmlFormPagamento(dadosAtuais, { comBotaoCancelar = true } = {}) {
  const cpfCnpjJaCadastrado = !!dadosAtuais.cpf_cnpj;
  const enderecoJaCadastrado = !!(dadosAtuais.endereco_cep && dadosAtuais.endereco_numero);
  const opcoesUF = UF_OPCOES.map((uf) => `<option value="${uf}" ${uf === dadosAtuais.endereco_uf ? 'selected' : ''}>${uf}</option>`).join('');
  const desabilitarEndereco = enderecoJaCadastrado ? 'disabled' : '';

  // CA02 (US37) — durante o trial ainda ativo, avisa antes do formulário que
  // o cadastro não cobra na hora; a cobrança só é agendada pro fim do trial
  // (nextDueDate calculado no backend, ver proximaCobrancaRespeitandoTrial).
  const bannerTrial = dadosAtuais.status === 'trial' && dadosAtuais.trial_ativo
    ? `
      <div class="trial-banner-cobranca-futura">
        <p>✅ Você não será cobrado agora.</p>
        <p>A primeira cobrança de ${formatarPreco(dadosAtuais.valor_plano)} será realizada em ${formatarDataCurtaISO(dadosAtuais.trial_fim)}.</p>
        <p>Você pode cancelar a qualquer momento antes dessa data sem custo.</p>
      </div>
    `
    : '';

  return `
    ${bannerTrial}
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
        ${comBotaoCancelar ? '<button type="button" class="btn-secundario" id="btn-cancelar-pagamento">Cancelar</button>' : ''}
        <button type="submit" class="btn-primario" id="btn-salvar-pagamento">Confirmar</button>
      </div>
    </form>
  `;
}

// Liga os listeners do formulário construído por htmlFormPagamento — usado
// tanto pro modal (abrirModalPagamento) quanto pro collapse inline
// (renderPagamentos) quanto pela tela de bloqueio pós-trial (US52).
// `onFechar` roda ao clicar Cancelar (só existe no modal); `onSucesso(resultado)`
// roda depois de um cadastro bem-sucedido, no lugar do comportamento padrão
// (mostrar toast e re-renderizar a aba).
function wireFormPagamento(dadosAtuais, { onFechar, onSucesso } = {}) {
  const enderecoJaCadastrado = !!(dadosAtuais.endereco_cep && dadosAtuais.endereco_numero);

  const btnCancelar = document.getElementById('btn-cancelar-pagamento');
  if (btnCancelar && onFechar) btnCancelar.addEventListener('click', onFechar);

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
      // CA05 (US37) — se o backend manteve o tenant em 'trial' (cobrança só
      // agendada pro fim do trial), o toast avisa disso em vez de dizer que a
      // assinatura já está ativa (o que só é verdade quando cobra na hora).
      const mensagem = resultado.status === 'trial'
        ? `Pagamento cadastrado! Você será cobrado em ${formatarDataCurtaISO(resultado.trial_fim)}. Até lá, aproveite o trial!`
        : 'Pagamento cadastrado com sucesso! Sua assinatura está ativa.';
      mostrarToast(mensagem, 'sucesso');
      if (onSucesso) onSucesso(resultado);
    } else {
      erroEl.textContent = (resultado && resultado.error) || 'Erro ao cadastrar pagamento.';
      btn.disabled = false;
      btn.textContent = 'Confirmar';
    }
  });
}
