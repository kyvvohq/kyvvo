// Regex de validação compartilhadas entre auth/perfil/equipe/admin —
// extraído de index.js (fase 1 da modularização).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Senha: mínimo 8 caracteres, ao menos 1 número e 1 letra maiúscula (CA02).
const SENHA_REGEX = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

module.exports = { EMAIL_REGEX, SENHA_REGEX };
