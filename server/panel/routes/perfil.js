// Perfil (US33) — extraído de index.js (fase 6 da modularização):
// GET/PATCH /api/perfil, PATCH /api/perfil/senha.
const bcrypt = require('bcryptjs');
const planos = require('../lib/planos');
const asaasService = require('../asaas-service');
const { SENHA_REGEX, UF_VALIDAS } = require('../lib/validadores');
const { normalizarWhatsapp } = require('../lib/whatsapp');

function registerPerfilRoutes(fastify, pool) {
  // Formato comum ao GET e à resposta do PATCH (CA02/CA05): nome_segmento é o
  // `tenants.nome` já existente (nome comercial); nome_responsavel é o nome do
  // próprio usuário logado (`usuarios.nome`) — um campo novo nesta US, distinto
  // do nome do negócio.
  async function buscarPerfil(userId) {
    const { rows } = await pool.query(
      `SELECT u.nome AS nome_responsavel, u.email,
              t.nome AS nome_segmento, t.telefone, t.whatsapp, t.plano, t.segmento,
              t.endereco_cep, t.endereco_logradouro, t.endereco_numero,
              t.endereco_complemento, t.endereco_bairro, t.endereco_cidade, t.endereco_uf
       FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [userId]
    );
    const perfil = rows[0];
    if (!perfil) return perfil;
    // CA05 — rótulo amigável do plano atual, mesma fonte usada no detalhe do
    // tenant na área admin (US28/nomeDoPlano), pra nunca divergir.
    return { ...perfil, plano_nome: planos.nomeDoPlano(perfil.plano) };
  }

  fastify.get('/api/perfil', { preHandler: [fastify.authenticate] }, async (request) => {
    return buscarPerfil(request.user.userId);
  });

  fastify.patch('/api/perfil', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { userId, tenantId } = request.user;
    // segmento não é editável pelo tenant — só a equipe Kyvvo altera, via
    // PATCH /admin/api/tenants/:id (CA05).
    const {
      nome_responsavel: nomeResponsavelBruto,
      nome_segmento: nomeSegmentoBruto,
      telefone: telefoneBruto,
      telefone_e_whatsapp: telefoneEWhatsapp,
      endereco,
    } = request.body || {};

    // Meu Perfil (dados pessoais) e Minha Empresa (dados do negócio, PR12)
    // viraram duas telas com botão de salvar independentes — cada grupo de
    // campo só é validado/atualizado quando vem no corpo da requisição
    // (padrão COALESCE, igual PATCH /api/configuracao já usa), em vez de
    // exigir tudo junto como antes.
    const grupoPessoal = nomeResponsavelBruto !== undefined || telefoneBruto !== undefined;
    let nomeResponsavel, telefone;
    if (grupoPessoal) {
      nomeResponsavel = (nomeResponsavelBruto || '').trim();
      if (nomeResponsavel.length < 2) {
        return reply.code(400).send({ error: 'Informe o nome do responsável.' });
      }
      telefone = normalizarWhatsapp(telefoneBruto);
      if (!telefone) {
        return reply.code(400).send({ error: 'Informe um telefone válido com DDD.' });
      }
    }

    let nomeSegmento;
    if (nomeSegmentoBruto !== undefined) {
      nomeSegmento = (nomeSegmentoBruto || '').trim();
      if (nomeSegmento.length < 2) {
        return reply.code(400).send({ error: 'Informe o nome do seu negócio.' });
      }
    }

    let enderecoValidado = null;
    if (endereco !== undefined) {
      const { cep, logradouro, numero, complemento, bairro, cidade, uf } = endereco || {};
      const cepLimpo = String(cep || '').replace(/\D/g, '');
      const enderecoCompleto =
        /^\d{8}$/.test(cepLimpo) &&
        (logradouro || '').trim() &&
        (numero || '').trim() &&
        (bairro || '').trim() &&
        (cidade || '').trim() &&
        UF_VALIDAS.includes(String(uf || '').toUpperCase());
      if (!enderecoCompleto) {
        return reply.code(400).send({ error: 'Preencha todos os campos do endereço.' });
      }
      enderecoValidado = {
        cep: cepLimpo,
        logradouro: logradouro.trim(),
        numero: numero.trim(),
        complemento: (complemento || '').trim() || null,
        bairro: bairro.trim(),
        cidade: cidade.trim(),
        uf: String(uf).toUpperCase(),
      };
    }

    const client = await pool.connect();
    let asaasCustomerId;
    try {
      await client.query('BEGIN');
      if (grupoPessoal) {
        await client.query('UPDATE usuarios SET nome = $2 WHERE id = $1', [userId, nomeResponsavel]);
      }
      // Checkbox "Este número também é o WhatsApp" (Meu Perfil) — evita o
      // dono ter que digitar o mesmo número duas vezes; telefone e whatsapp
      // continuam sendo colunas separadas (whatsapp é chave única, usada no
      // cadastro self-service/reenvio de verificação/admin), então só
      // espelha telefone → whatsapp quando o tenant marca a opção e o
      // telefone está de fato sendo atualizado nesta requisição.
      // endereco_complemento usa CASE (em vez de COALESCE) porque é o único
      // subcampo opcional do grupo endereço — precisa poder ser limpo pra
      // null quando o endereço é atualizado, mas não pode ser tocado quando
      // o grupo inteiro está ausente; $4 (cep) só é não-nulo quando o grupo
      // endereço está presente, então serve de sinalizador (mesmo truque já
      // usado em horario_almoco_inicio no PATCH de Configuração).
      const { rows: tenantAtualizado } = await client.query(
        `UPDATE tenants SET
           nome = COALESCE($2, nome),
           telefone = COALESCE($3, telefone),
           whatsapp = CASE WHEN $3 IS NOT NULL AND $11 THEN $3 ELSE whatsapp END,
           endereco_cep = COALESCE($4, endereco_cep),
           endereco_logradouro = COALESCE($5, endereco_logradouro),
           endereco_numero = COALESCE($6, endereco_numero),
           endereco_complemento = CASE WHEN $4 IS NOT NULL THEN $7 ELSE endereco_complemento END,
           endereco_bairro = COALESCE($8, endereco_bairro),
           endereco_cidade = COALESCE($9, endereco_cidade),
           endereco_uf = COALESCE($10, endereco_uf)
         WHERE id = $1
         RETURNING asaas_customer_id`,
        [
          tenantId,
          nomeSegmento ?? null,
          telefone ?? null,
          enderecoValidado?.cep ?? null,
          enderecoValidado?.logradouro ?? null,
          enderecoValidado?.numero ?? null,
          enderecoValidado?.complemento ?? null,
          enderecoValidado?.bairro ?? null,
          enderecoValidado?.cidade ?? null,
          enderecoValidado?.uf ?? null,
          !!telefoneEWhatsapp,
        ]
      );
      asaasCustomerId = tenantAtualizado[0].asaas_customer_id;
      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK');
      if (erro.code === '23505' && /whatsapp/i.test(erro.constraint || '')) {
        return reply.code(409).send({ error: 'Este número já está cadastrado como WhatsApp de outra conta.' });
      }
      throw erro;
    } finally {
      client.release();
    }

    // CA08 — mantém o Customer da Asaas sincronizado quando o tenant já tem
    // assinatura (US32). Best-effort: uma falha aqui não deve impedir o
    // perfil de ser salvo, já que os dados já estão persistidos no Kyvvo.
    // Só roda quando o grupo pessoal (nome/telefone) de fato veio nesta
    // requisição — salvar só Minha Empresa não tem nome/telefone novos pra
    // sincronizar.
    if (asaasCustomerId && grupoPessoal) {
      asaasService
        .atualizarCustomer({ customerId: asaasCustomerId, nome: nomeResponsavel, whatsapp: telefone })
        .catch((erro) => console.error(`[perfil] falha ao sincronizar customer ${asaasCustomerId} na Asaas: ${erro.message}`));
    }

    return buscarPerfil(userId);
  });

  // Alterar senha (Meu Perfil) — mesma validação de SENHA_REGEX do cadastro
  // e do "esqueci minha senha" (POST /api/auth/redefinir-senha). Diferente
  // daquele fluxo, aqui exige a senha atual (usuário já está autenticado,
  // não veio de um código por e-mail). token_version++ derruba a sessão
  // atual e qualquer outra aberta — mesmo efeito de segurança da
  // redefinição por e-mail: depois de trocar a senha, precisa logar de novo.
  fastify.patch('/api/perfil/senha', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const { senha_atual: senhaAtual, senha_nova: senhaNova } = request.body || {};

    if (!SENHA_REGEX.test(senhaNova || '')) {
      return reply.code(400).send({
        error: 'A senha deve ter no mínimo 8 caracteres, 1 número e 1 letra maiúscula.',
      });
    }

    const { rows } = await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [userId]);
    const usuario = rows[0];
    const senhaValida = usuario && (await bcrypt.compare(senhaAtual || '', usuario.senha_hash));
    if (!senhaValida) {
      return reply.code(400).send({ error: 'Senha atual incorreta.' });
    }

    const hash = await bcrypt.hash(senhaNova, 10);
    await pool.query(
      'UPDATE usuarios SET senha_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [hash, userId]
    );

    return { ok: true };
  });
}

module.exports = { registerPerfilRoutes };
