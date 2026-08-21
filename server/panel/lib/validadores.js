// Regex/listas de validação compartilhadas entre auth/perfil/equipe/admin —
// extraído de index.js (fase 1 da modularização; UF_VALIDAS na fase 6,
// compartilhada entre Perfil e Pagamentos/Asaas — validação de endereço).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Senha: mínimo 8 caracteres, ao menos 1 número e 1 letra maiúscula (CA02).
const SENHA_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
const UF_VALIDAS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
  'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

module.exports = { EMAIL_REGEX, SENHA_REGEX, UF_VALIDAS };
