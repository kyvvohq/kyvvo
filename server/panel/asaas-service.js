// Cliente Asaas do Studio = @kyvvohq/asaas, sem customização (produtoNome
// default 'Kyvvo').
//
// Antes desta troca este arquivo era a implementação canônica (~180 linhas)
// e o kyvvo-people mantinha uma cópia. Agora os dois consomem o pacote único
// publicado no GitHub Packages privado da org kyvvohq. Contrato e histórico
// dos achados (PAYMENT_REFUNDED, SUBSCRIPTION_DELETED, description defasada)
// ficam no README do pacote.
module.exports = require('@kyvvohq/asaas');
