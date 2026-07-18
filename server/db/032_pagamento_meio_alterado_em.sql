-- Data da última alteração da forma de pagamento (Pix/Cartão), pra exibir no
-- card "Meio de pagamento" da aba Pagamento (PR5). Setada toda vez que
-- asaas_meio_pagamento é gravado em POST /api/pagamentos/cadastrar.

alter table tenants add column asaas_meio_pagamento_alterado_em timestamptz;
