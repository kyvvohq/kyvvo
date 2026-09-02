# Cutover dos secrets pro AWS SSM Parameter Store

Tira os `environment:` inline (texto puro) do `/opt/kyvvo/docker-compose.yml`
e passa a resolvê-los do SSM. Item do P2.

## Estado

- ✅ **Parâmetros no SSM** (2026-09-02) — 66 params `SecureString` em
  `/kyvvo/<serviço>/<KEY>`, um por entrada de `environment:` do compose atual
  (`postgres`, `n8n`, `evolution-api`, `landing`, `studio`, `people`).
- ✅ **IAM** — o instance profile `kyvvo-ec2-backup-role` ganhou a policy
  inline `kyvvo-ssm`: `ssm:{Put,Get,GetParameters,GetParametersByPath,Delete}Parameter`
  em `/kyvvo/*` + `kms:{Encrypt,Decrypt}` via `ssm.us-east-1`.
- ✅ **Script de geração** — `server/scripts/gen-env-from-ssm.sh`, deployado
  em `/opt/kyvvo/scripts/`.
- ⬜ **Cutover** (abaixo) — ainda não feito.

## Re-popular o SSM a partir do compose (se `environment:` mudar)

Script one-off (não versionado) que lê o compose linha a linha e faz
`aws ssm put-parameter --type SecureString --overwrite`. Rodar na EC2.
⚠️ o AWS CLI dereferencia valores que começam com `http://`/`https://` —
`aws configure set cli_follow_urlparam false` antes.

## Cutover (fazer numa janela, com o backup do compose à mão)

1. **Gerar e conferir os env files** (não muda nada ainda):
   ```bash
   /opt/kyvvo/scripts/gen-env-from-ssm.sh          # gera /opt/kyvvo/env/<svc>.env (mode 600)
   # conferir contra o inline atual, por serviço:
   for s in postgres n8n evolution-api landing studio people; do
     echo "== $s =="; sort /opt/kyvvo/env/$s.env
   done
   ```
   Comparar as chaves/valores com o bloco `environment:` de cada serviço no
   `docker-compose.yml`. Têm que bater 1:1.

2. **Backup do compose**:
   ```bash
   sudo cp -a /opt/kyvvo/docker-compose.yml /opt/kyvvo/docker-compose.yml.bak-$(date +%s)
   ```

3. **Editar o compose** — em cada serviço, trocar o bloco inteiro
   `environment:` ... por:
   ```yaml
       env_file:
         - ./env/<serviço>.env
   ```
   (`NPM_PACKAGES_TOKEN` sai do `.env` da raiz e passa a vir do env_file do
   serviço — já está no SSM em `/kyvvo/studio/` e `/kyvvo/people/`.)

4. **Validar + recriar**:
   ```bash
   sudo docker compose -f /opt/kyvvo/docker-compose.yml config --quiet && echo YAML OK
   cd /opt/kyvvo && sudo docker compose up -d
   ```

5. **Verificar**: `docker compose ps`, `curl -sI` nos 3 sites + n8n + manager,
   login no Studio e no People, uma tela com dados de cada.

6. **Wire nos deploys** — nos `deploy.yml` do `kyvvo` (job `deploy-panel`) e
   do `kyvvo-people`, adicionar antes do `docker compose restart`:
   `/opt/kyvvo/scripts/gen-env-from-ssm.sh` e trocar `restart <svc>` por
   `up -d <svc>` (pra pegar env_file novo). O `deploy-backup.yml` não muda.

7. **`.gitignore` na EC2** — `echo '*' | sudo tee /opt/kyvvo/env/.gitignore`
   (defensivo; esse dir não é repo, mas evita acidente).

8. Atualizar `kyvvohq/kyvvo-infra` com o compose novo (blocos `env_file`).

## Rollback

`sudo cp /opt/kyvvo/docker-compose.yml.bak-<ts> /opt/kyvvo/docker-compose.yml`
e `sudo docker compose up -d`. Os `environment:` inline voltam. Os params no
SSM podem ficar (não atrapalham).
