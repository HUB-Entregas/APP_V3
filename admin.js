// Token de administrador fica só EM MEMÓRIA (nunca salvo no navegador) — ao
// atualizar a página, o administrador precisa entrar de novo. É intencional.
// Ele é emitido pelo backend no login (acao 'admin-login') e enviado em todas
// as chamadas do painel (listar / finalizar / foto), sempre por POST — a senha
// nunca vai na URL.
let adminToken = null;
let registrosCache = [];
let listaRenderizada = []; // última lista mostrada na tabela (base p/ o modal)
const cacheFotos = {};     // id do Drive -> dataUrl (evita rebaixar a mesma 2x)

function el(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatarData(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function apiPost(payload) {
  const resp = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

// se o backend disser que a sessão expirou (token de 8h venceu), volta ao login
function sessaoExpirou(data) {
  if (data && data.authErro) { sair(); mostrarErroLogin('Sessão expirada. Entre novamente.'); return true; }
  return false;
}

async function fazerLogin() {
  const senha = el('senhaInput').value;
  if (!senha) return;
  const botao = el('btnEntrar');
  botao.disabled = true;
  botao.textContent = 'Entrando…';
  el('loginErro').classList.add('hidden');

  try {
    const login = await apiPost({ acao: 'admin-login', senha });
    if (login.status !== 'ok' || !login.token) {
      mostrarErroLogin(login.message || 'Senha incorreta.');
      return;
    }
    adminToken = login.token;
    const data = await apiPost({ acao: 'listar', token: adminToken });
    if (data.status !== 'ok') {
      adminToken = null;
      mostrarErroLogin(data.message || 'Não foi possível carregar os comprovantes.');
      return;
    }
    registrosCache = data.registros;
    mostrarPainel();
  } catch (err) {
    mostrarErroLogin('Não foi possível conectar. Verifique sua internet e a URL configurada em config.js.');
  } finally {
    botao.disabled = false;
    botao.textContent = 'Entrar';
  }
}

function mostrarErroLogin(msg) {
  const erro = el('loginErro');
  erro.textContent = msg;
  erro.classList.remove('hidden');
}

function mostrarPainel() {
  el('telaLogin').classList.add('hidden');
  el('telaPainel').classList.remove('hidden');
  el('btnSair').classList.remove('hidden');
  renderTabela(registrosCache);
}

function sair() {
  adminToken = null;
  registrosCache = [];
  listaRenderizada = [];
  for (const k in cacheFotos) delete cacheFotos[k]; // não guarda fotos após sair
  el('senhaInput').value = '';
  el('busca').value = '';
  fecharFoto();
  el('telaPainel').classList.add('hidden');
  el('btnSair').classList.add('hidden');
  el('telaLogin').classList.remove('hidden');
}

async function atualizar() {
  if (!adminToken) return;
  const botao = el('btnAtualizar');
  botao.disabled = true;
  botao.textContent = 'Atualizando…';
  try {
    const data = await apiPost({ acao: 'listar', token: adminToken });
    if (sessaoExpirou(data)) return;
    if (data.status === 'ok') {
      registrosCache = data.registros;
      renderTabela(filtrarPorBusca(registrosCache));
    }
  } catch (err) {
    // sem internet no momento — mantém a última lista carregada na tela
  } finally {
    botao.disabled = false;
    botao.textContent = '🔄 Atualizar';
  }
}

function filtrarPorBusca(lista) {
  const termo = el('busca').value.trim().toLowerCase();
  if (!termo) return lista;
  return lista.filter((r) =>
    (r.recebedor || '').toLowerCase().includes(termo) ||
    (r.motorista || '').toLowerCase().includes(termo) ||
    (r.empresa || '').toLowerCase().includes(termo)
  );
}

function botaoFinalizado(r) {
  const finalizado = !!r.finalizado;
  const semId = !r.id;
  const atributos = semId ? 'disabled title="Comprovante antigo sem ID — não pode ser atualizado"' : '';
  return `<button type="button" class="btn-finalizar ${finalizado ? 'is-finalizado' : ''}" data-id="${escapeHtml(r.id)}" data-finalizado="${finalizado}" ${atributos}>${finalizado ? '✔ Finalizado' : 'Finalizado'}</button>`;
}

function botaoFoto(r, i, tipo, temFoto) {
  if (!temFoto) return '—';
  return `<button type="button" class="btn-foto-mini" data-idx="${i}" data-tipo="${tipo}">📷 Ver</button>`;
}

function renderTabela(lista) {
  listaRenderizada = lista;
  const corpo = el('tabelaCorpo');
  const vazio = el('vazioAviso');
  el('contagem').textContent = `${lista.length} comprovante(s)`;
  corpo.innerHTML = '';

  if (lista.length === 0) {
    vazio.classList.remove('hidden');
    return;
  }
  vazio.classList.add('hidden');

  const linhas = lista.map((r, i) => `
    <tr>
      <td>${formatarData(r.dataHora)}</td>
      <td>${r.empresa ? `<span class="tag-empresa-admin tag-${escapeHtml(String(r.empresa).toLowerCase())}">${escapeHtml(r.empresa)}</span>` : '—'}</td>
      <td>${escapeHtml(r.motorista)}</td>
      <td>${escapeHtml(r.recebedor)}</td>
      <td>${escapeHtml(r.observacao)}</td>
      <td>${botaoFoto(r, i, 'pacote', !!r.fotoPacoteId)}</td>
      <td>${botaoFoto(r, i, 'fachada', !!r.fotoFachadaId)}</td>
      <td>${botaoFinalizado(r)}</td>
    </tr>`).join('');
  corpo.innerHTML = linhas;
}

// ---------- modal de fotos (galeria pacote/fachada + zoom) ----------
// As fotos são PRIVADAS no Drive: cada uma é buscada sob demanda pela rota
// 'foto' (autenticada) só quando o admin abre o modal — nada é carregado à toa.
let modalFotos = [];   // [{ id, legenda }] do comprovante aberto
let modalIndice = 0;
let modalRegistro = null; // comprovante aberto no modal (p/ o botão Finalizar)
let zoom = 1, panX = 0, panY = 0;
let arrastando = false, arrasteOrigem = null, arrastou = false;

function abrirModal(registro, tipoInicial) {
  modalFotos = [];
  if (registro.fotoPacoteId) modalFotos.push({ id: registro.fotoPacoteId, legenda: 'Foto do pacote' });
  if (registro.fotoFachadaId) modalFotos.push({ id: registro.fotoFachadaId, legenda: 'Foto da fachada' });
  if (modalFotos.length === 0) return;

  const inicial = modalFotos.findIndex((f) => f.legenda.toLowerCase().includes(tipoInicial));
  modalIndice = inicial >= 0 ? inicial : 0;

  el('modalRecebedor').textContent = registro.recebedor || '(sem recebedor)';
  el('modalMeta').textContent = `${registro.empresa ? registro.empresa + ' · ' : ''}${registro.motorista || '—'} · ${formatarData(registro.dataHora)}`;
  const obs = el('modalObs');
  obs.textContent = registro.observacao || '';
  obs.classList.toggle('hidden', !registro.observacao);

  modalRegistro = registro;
  atualizarBotaoModalFinalizar();

  el('modalFoto').classList.remove('hidden');
  mostrarFotoAtual();
}

// Botão "Finalizar" dentro do visualizador — o admin marca a entrega sem
// precisar fechar a foto e procurar a linha na tabela.
function atualizarBotaoModalFinalizar() {
  const btn = el('modalFinalizar');
  if (!modalRegistro || !modalRegistro.id) { btn.classList.add('hidden'); return; }
  btn.classList.remove('hidden');
  const finalizado = !!modalRegistro.finalizado;
  btn.classList.toggle('is-finalizado', finalizado);
  btn.textContent = finalizado ? '✔ Finalizado' : 'Finalizar';
}

async function finalizarDoModal() {
  if (!modalRegistro || !modalRegistro.id) return;
  const btn = el('modalFinalizar');
  btn.disabled = true;
  // reusa o mesmo fluxo da tabela (otimista + reverte se falhar)
  await toggleFinalizado(modalRegistro.id, !modalRegistro.finalizado);
  btn.disabled = false;
  atualizarBotaoModalFinalizar();
}

async function mostrarFotoAtual() {
  const foto = modalFotos[modalIndice];
  el('modalLegenda').textContent = `${foto.legenda} — ${modalIndice + 1}/${modalFotos.length}`;
  const temVarias = modalFotos.length > 1;
  el('modalAnterior').classList.toggle('hidden', !temVarias);
  el('modalProximo').classList.toggle('hidden', !temVarias);
  resetarZoom();

  const img = el('modalImg');

  // já em cache? mostra na hora
  if (cacheFotos[foto.id]) { img.src = cacheFotos[foto.id]; el('modalCarregando').classList.add('hidden'); return; }

  img.src = '';
  el('modalCarregando').classList.remove('hidden');
  const idAlvo = foto.id;
  try {
    const data = await apiPost({ acao: 'foto', token: adminToken, id: idAlvo });
    if (sessaoExpirou(data)) return;
    if (data.status === 'ok' && data.dataUrl) {
      cacheFotos[idAlvo] = data.dataUrl;
      // só aplica se ainda for a foto atual (o admin pode ter navegado/fechado)
      const atual = modalFotos[modalIndice];
      if (atual && atual.id === idAlvo && !el('modalFoto').classList.contains('hidden')) {
        img.src = data.dataUrl;
      }
    }
  } catch (err) {
    // deixa vazio; o admin pode navegar de novo para tentar
  } finally {
    el('modalCarregando').classList.add('hidden');
  }
}

function navegarFoto(delta) {
  if (modalFotos.length < 2) return;
  modalIndice = (modalIndice + delta + modalFotos.length) % modalFotos.length;
  mostrarFotoAtual();
}

// Cola as setas na borda da FOTO (não na borda da tela) para acesso rápido.
// Recalculado quando a imagem carrega e quando a janela muda de tamanho.
function posicionarSetas() {
  const esq = el('modalAnterior');
  const dir = el('modalProximo');
  if (el('modalFoto').classList.contains('hidden') || esq.classList.contains('hidden')) return;
  const palco = el('modalPalco').getBoundingClientRect();
  const img = el('modalImg').getBoundingClientRect();
  if (!img.width) { esq.style.left = '10px'; dir.style.right = '10px'; return; }
  // 52 = largura da seta (44) + 8px de folga; nunca sai da tela (mín. 8px)
  esq.style.left = Math.max(8, img.left - palco.left - 52) + 'px';
  dir.style.right = Math.max(8, palco.right - img.right - 52) + 'px';
}

function resetarZoom() {
  zoom = 1; panX = 0; panY = 0;
  el('modalImg').classList.remove('is-zoom');
  aplicarTransform();
}

function aplicarTransform() {
  el('modalImg').style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

function alternarZoom() {
  if (zoom === 1) {
    zoom = 2.5;
    el('modalImg').classList.add('is-zoom');
    aplicarTransform();
  } else {
    resetarZoom();
  }
}

function fecharFoto() {
  el('modalFoto').classList.add('hidden');
  el('modalImg').src = '';
  el('modalCarregando').classList.add('hidden');
  modalRegistro = null;
  resetarZoom();
}

async function toggleFinalizado(id, novoValor) {
  if (!id) return;
  atualizarFinalizadoLocal(id, novoValor); // atualiza a tela na hora
  try {
    const data = await apiPost({ acao: 'finalizar', token: adminToken, id, valor: novoValor });
    if (data.authErro) { atualizarFinalizadoLocal(id, !novoValor); sessaoExpirou(data); return; }
    if (data.status !== 'ok') {
      atualizarFinalizadoLocal(id, !novoValor); // reverte se falhou
      alert(data.message || 'Não foi possível atualizar. Tente novamente.');
    }
  } catch (err) {
    atualizarFinalizadoLocal(id, !novoValor); // reverte se ficou offline
    alert('Sem conexão no momento. Tente novamente.');
  }
}

function atualizarFinalizadoLocal(id, valor) {
  const registro = registrosCache.find((r) => r.id === id);
  if (registro) registro.finalizado = valor;
  renderTabela(filtrarPorBusca(registrosCache));
}

window.addEventListener('DOMContentLoaded', () => {
  el('btnEntrar').addEventListener('click', fazerLogin);
  el('senhaInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') fazerLogin(); });
  el('btnSair').addEventListener('click', sair);
  el('btnAtualizar').addEventListener('click', atualizar);
  el('busca').addEventListener('input', () => renderTabela(filtrarPorBusca(registrosCache)));
  el('senhaInput').focus();

  // delegação de eventos: "Ver" abre o modal (busca a foto), botão alterna status
  el('tabelaCorpo').addEventListener('click', (e) => {
    const btnFoto = e.target.closest('.btn-foto-mini');
    if (btnFoto) {
      const registro = listaRenderizada[Number(btnFoto.dataset.idx)];
      if (registro) abrirModal(registro, btnFoto.dataset.tipo);
      return;
    }
    const btn = e.target.closest('.btn-finalizar');
    if (btn && !btn.disabled) {
      toggleFinalizado(btn.dataset.id, btn.dataset.finalizado !== 'true');
    }
  });

  // --- controles do modal ---
  el('modalFechar').addEventListener('click', fecharFoto);
  el('modalAnterior').addEventListener('click', () => navegarFoto(-1));
  el('modalProximo').addEventListener('click', () => navegarFoto(1));
  el('modalFinalizar').addEventListener('click', finalizarDoModal);
  el('modalImg').addEventListener('load', posicionarSetas);
  window.addEventListener('resize', posicionarSetas);

  // clicar no fundo (fora da imagem/setas) fecha
  el('modalPalco').addEventListener('click', (e) => {
    if (e.target === el('modalPalco')) fecharFoto();
  });

  // zoom por clique + arrastar para mover quando ampliado (mouse e toque)
  const modalImg = el('modalImg');
  modalImg.addEventListener('pointerdown', (e) => {
    arrastando = true;
    arrastou = false;
    arrasteOrigem = { x: e.clientX - panX, y: e.clientY - panY };
    modalImg.setPointerCapture(e.pointerId);
  });
  modalImg.addEventListener('pointermove', (e) => {
    if (!arrastando || zoom === 1) return;
    panX = e.clientX - arrasteOrigem.x;
    panY = e.clientY - arrasteOrigem.y;
    arrastou = true;
    aplicarTransform();
  });
  modalImg.addEventListener('pointerup', () => {
    arrastando = false;
    if (!arrastou) alternarZoom(); // clique simples (sem arrastar) alterna o zoom
  });

  // teclado: Esc fecha, setas trocam de foto
  window.addEventListener('keydown', (e) => {
    if (el('modalFoto').classList.contains('hidden')) return;
    if (e.key === 'Escape') fecharFoto();
    else if (e.key === 'ArrowLeft') navegarFoto(-1);
    else if (e.key === 'ArrowRight') navegarFoto(1);
  });
});
