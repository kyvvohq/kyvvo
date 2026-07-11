const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Conexão com PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Criar tabela ao iniciar (se não existir)
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lista_espera (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL,
        whatsapp TEXT,
        nicho TEXT,
        idioma TEXT DEFAULT 'pt',
        criado_em TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Tabela lista_espera pronta');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS diagnosticos (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        respostas JSONB NOT NULL,
        score INTEGER NOT NULL,
        plano_sugerido TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Tabela diagnosticos pronta');
  } catch (err) {
    console.error('❌ Erro ao criar tabela:', err.message);
  }
}

// Rota principal — serve a landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// POST /waitlist — salva lead no banco
app.post('/waitlist', async (req, res) => {
  const { nome, email, whatsapp, nicho, idioma } = req.body;

  // Validação básica
  if (!nome || !nome.trim()) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }

  try {
    // Verificar se e-mail já está na lista
    const existing = await pool.query(
      'SELECT id FROM lista_espera WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (existing.rows.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'already_registered'
      });
    }

    // Inserir novo lead
    await pool.query(
      `INSERT INTO lista_espera (nome, email, whatsapp, nicho, idioma)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        nome.trim(),
        email.toLowerCase().trim(),
        whatsapp ? whatsapp.trim() : null,
        nicho || null,
        idioma || 'pt'
      ]
    );

    console.log(`✅ Novo lead: ${email} — nicho: ${nicho}`);

    return res.status(201).json({
      success: true,
      message: 'registered'
    });

  } catch (err) {
    console.error('❌ Erro ao salvar lead:', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// POST /diagnostico — salva as respostas do quiz de diagnóstico (lead gen)
app.post('/diagnostico', async (req, res) => {
  const { nome, respostas, score, plano } = req.body;

  if (!nome || !nome.trim()) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }
  if (typeof score !== 'number') {
    return res.status(400).json({ error: 'Score inválido' });
  }

  try {
    await pool.query(
      `INSERT INTO diagnosticos (nome, respostas, score, plano_sugerido)
       VALUES ($1, $2, $3, $4)`,
      [nome.trim(), JSON.stringify(respostas || {}), score, plano || null]
    );

    console.log(`✅ Novo diagnóstico: ${nome} — score: ${score}%`);

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('❌ Erro ao salvar diagnóstico:', err.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// GET /waitlist/count — contador público de inscritos
app.get('/waitlist/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM lista_espera');
    return res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    return res.json({ count: 0 });
  }
});

// Iniciar servidor
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Kyvvo landing page rodando na porta ${PORT}`);
  });
});
