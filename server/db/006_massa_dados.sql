-- Kyvvo — massa de dados adicional pra teste do painel
DO $$
DECLARE
  v_tenant uuid := 'f8f8601d-b395-475b-a8ae-d6059426daf9';
  v_ana uuid;
  v_bruna uuid;
  v_corte uuid;
  v_escova uuid;
  v_coloracao uuid;
  v_cliente uuid;
  nomes text[] := ARRAY['Marina Silva','Julia Santos','Camila Costa','Fernanda Lima','Patrícia Alves','Beatriz Rocha','Larissa Souza','Amanda Pereira'];
  telefones text[] := ARRAY['5511911111001','5511911111002','5511911111003','5511911111004','5511911111005','5511911111006','5511911111007','5511911111008'];
  i int;
  dia_offset int;
  hora_escolhida int;
  profissional_escolhido uuid;
  servico_escolhido uuid;
  duracao int;
BEGIN
  SELECT id INTO v_ana FROM profissionais WHERE tenant_id = v_tenant AND nome = 'Ana';
  SELECT id INTO v_bruna FROM profissionais WHERE tenant_id = v_tenant AND nome = 'Bruna';
  SELECT id INTO v_corte FROM servicos WHERE tenant_id = v_tenant AND nome = 'Corte';
  SELECT id INTO v_escova FROM servicos WHERE tenant_id = v_tenant AND nome = 'Escova';
  SELECT id INTO v_coloracao FROM servicos WHERE tenant_id = v_tenant AND nome = 'Coloração';

  FOR i IN 1..8 LOOP
    INSERT INTO clientes (tenant_id, nome, telefone)
    VALUES (v_tenant, nomes[i], telefones[i])
    ON CONFLICT (tenant_id, telefone) DO UPDATE SET nome = EXCLUDED.nome
    RETURNING id INTO v_cliente;

    -- espalha agendamentos entre -5 e +20 dias a partir de hoje
    dia_offset := (i * 3) - 5;
    hora_escolhida := (ARRAY[9,10,11,14,15,16,17])[1 + (i % 7)];
    profissional_escolhido := CASE WHEN i % 2 = 0 THEN v_ana ELSE v_bruna END;

    CASE i % 3
      WHEN 0 THEN servico_escolhido := v_corte; duracao := 30;
      WHEN 1 THEN servico_escolhido := v_escova; duracao := 45;
      ELSE servico_escolhido := v_coloracao; duracao := 90;
    END CASE;

    INSERT INTO agendamentos (tenant_id, cliente_id, profissional_id, servico_id, data_hora, status)
    VALUES (
      v_tenant, v_cliente, profissional_escolhido, servico_escolhido,
      (CURRENT_DATE + (dia_offset || ' days')::interval + (hora_escolhida || ' hours')::interval) AT TIME ZONE 'America/Sao_Paulo',
      CASE WHEN dia_offset < 0 THEN 'confirmado' ELSE 'confirmado' END
    );

    -- segundo agendamento pra alguns clientes, horário diferente, mesmo dia +1
    IF i % 2 = 0 THEN
      INSERT INTO agendamentos (tenant_id, cliente_id, profissional_id, servico_id, data_hora, status)
      VALUES (
        v_tenant, v_cliente,
        CASE WHEN profissional_escolhido = v_ana THEN v_bruna ELSE v_ana END,
        v_corte,
        (CURRENT_DATE + (dia_offset + 1 || ' days')::interval + '11 hours'::interval) AT TIME ZONE 'America/Sao_Paulo',
        'confirmado'
      );
    END IF;
  END LOOP;
END $$;

SELECT count(*) AS total_clientes FROM clientes WHERE tenant_id = 'f8f8601d-b395-475b-a8ae-d6059426daf9';
SELECT count(*) AS total_agendamentos FROM agendamentos WHERE tenant_id = 'f8f8601d-b395-475b-a8ae-d6059426daf9';
