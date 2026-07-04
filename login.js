// LOGIN DO MOTORISTA — tela separada. O motorista escolhe o nome, digita a
// senha e entra. A senha é conferida no BACKEND (Apps Script), não neste
// arquivo — por isso o primeiro login (ou após "Trocar") precisa de internet.
// Depois de logar, o aparelho lembra o motorista e não pede senha de novo.

function el(id) { return document.getElementById(id); }

function mostrarAviso(msg) {
  const aviso = el('aviso');
  aviso.textContent = msg;
  aviso.className = 'aviso aviso-erro';
}

async function verificarSenha(nome, senha) {
  // timeout: rede instável não pode deixar o botão preso em "Entrando…"
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let resp;
  try {
    resp = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      signal: ctrl.signal,
      body: JSON.stringify({ acao: 'login', nome, senha })
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

window.addEventListener('DOMContentLoaded', () => {
  const select = el('motoristaSelect');
  const senha = el('senhaInput');
  const botao = el('btnEntrar');

  // popula o select com os nomes (textContent evita qualquer HTML)
  CONFIG.MOTORISTAS.forEach((nome) => {
    const opt = document.createElement('option');
    opt.value = nome;
    opt.textContent = nome;
    select.appendChild(opt);
  });

  el('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = select.value;
    if (!nome || !senha.value) return;

    botao.disabled = true;
    botao.textContent = 'Entrando…';
    el('aviso').classList.add('hidden');

    try {
      const data = await verificarSenha(nome, senha.value);
      if (data.status === 'ok' && data.token) {
        localStorage.setItem('motoristaSelecionado', nome);
        localStorage.setItem('authToken', data.token); // token de sessão p/ gravar comprovantes
        window.location.replace('./index.html');
        return;
      }
      mostrarAviso(data.message || 'Motorista ou senha incorretos.');
      senha.value = '';
      senha.focus();
    } catch (err) {
      mostrarAviso('Sem conexão — conecte à internet para entrar pela primeira vez.');
    } finally {
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });
});
