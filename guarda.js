// GUARDA DE ROTA — roda no <head>, antes do corpo renderizar.
// Está num arquivo separado (não inline) para permitir um CSP rígido
// (script-src 'self') sem 'unsafe-inline'. O modo vem do próprio <script>:
//   data-modo="requer-login"     -> sem motorista salvo, vai para o login
//   data-modo="requer-deslogado" -> com motorista salvo, pula para o app
(function () {
  var script = document.currentScript;
  var modo = script && script.dataset ? script.dataset.modo : '';
  var logado = !!localStorage.getItem('motoristaSelecionado');
  if (modo === 'requer-login' && !logado) {
    window.location.replace('./login.html');
  } else if (modo === 'requer-deslogado' && logado) {
    window.location.replace('./index.html');
  }
})();
