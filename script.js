/* =========================================================================
 * Mozilla x Dev.to — SPA (Single Page Application)
 * Projeto Prático 2 — Programação Web Frontend (UTFPR)
 *
 * Funcionalidades:
 *  - Busca de artigos na API pública do Dev.to (Forem) via Fetch + async/await
 *  - Validação dos campos de busca (não vazio, mínimo 3 caracteres)
 *  - Mensagens de validação amigáveis
 *  - Marcar/desmarcar favoritos
 *  - Persistência dos favoritos em localStorage
 *  - Listagem dos favoritos
 *  - Navegação entre abas sem recarregar a página (SPA)
 *  - Tratamento de erros: rede, HTTP, timeout, resposta vazia/ inválida
 *
 * Stack: JavaScript Vanilla (ES6+). Sem bibliotecas externas.
 * ========================================================================= */

(() => {
    'use strict';

    // ──────────────── Constantes / Configuração ────────────────
    const API_BASE = 'https://dev.to/api/articles';
    const STORAGE_KEY = 'mozilla_devto_favoritos_v1';
    const TIMEOUT_MS = 10000;
    const MIN_QUERY = 3;
    const PER_PAGE = 24;

    // ──────────────── Seletores ────────────────
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    const form = $('#formBusca');
    const inputBusca = $('#campoBusca');
    const erroBusca = $('#erroBusca');
    const listaResultados = $('#listaResultados');
    const listaFavoritos = $('#listaFavoritos');
    const statusResultados = $('#statusResultados');
    const statusFavoritos = $('#statusFavoritos');
    const painelResultados = $('#painelResultados');
    const painelFavoritos = $('#painelFavoritos');
    const contadorHeader = $('#contadorFavoritos');
    const contadorAba = $('#contadorAba');
    const secaoApp = $('#appArtigos');

    // ──────────────── Estado ────────────────
    const estado = {
        aba: 'resultados',         // 'resultados' | 'favoritos'
        ultimaBusca: '',
        favoritos: carregarFavoritos(), // Map<id, artigo>
    };

    // ════════════════ Persistência (localStorage) ════════════════
    function carregarFavoritos() {
        try {
            const bruto = localStorage.getItem(STORAGE_KEY);
            if (!bruto) return new Map();
            const arr = JSON.parse(bruto);
            if (!Array.isArray(arr)) return new Map();
            return new Map(arr.map((a) => [String(a.id), a]));
        } catch (err) {
            console.warn('Falha ao ler favoritos do localStorage:', err);
            return new Map();
        }
    }

    function salvarFavoritos() {
        try {
            const arr = Array.from(estado.favoritos.values());
            localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
        } catch (err) {
            console.warn('Falha ao salvar favoritos:', err);
        }
    }

    function alternarFavorito(artigo) {
        const id = String(artigo.id);
        if (estado.favoritos.has(id)) {
            estado.favoritos.delete(id);
        } else {
            estado.favoritos.set(id, artigo);
        }
        salvarFavoritos();
        atualizarContadores();
        // Re-render botão na lista atual + lista de favoritos
        sincronizarBotoesFavoritos();
        renderizarFavoritos();
    }

    // ════════════════ API Dev.to ════════════════
    /**
     * Faz uma requisição GET com timeout e tratamento de HTTP/rede.
     */
    async function requisicaoJson(url, { timeout = TIMEOUT_MS } = {}) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        try {
            const resp = await fetch(url, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: ctrl.signal,
            });
            if (!resp.ok) {
                throw new Error(`Erro HTTP ${resp.status} ao consultar a API.`);
            }
            const dados = await resp.json();
            if (dados == null) throw new Error('Resposta vazia recebida da API.');
            return dados;
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error('Tempo esgotado ao consultar a API. Tente novamente.');
            }
            if (err instanceof TypeError) {
                throw new Error('Falha de conexão. Verifique sua internet.');
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Busca artigos no Dev.to. Os parâmetros válidos da API incluem
     * `tag` (uma tag) e `per_page`. Como uma busca textual livre,
     * fazemos duas tentativas: por tag (normalizada) e, em paralelo,
     * uma busca geral; depois filtramos no cliente por título/tags.
     */
    async function buscarArtigos(termo) {
        const q = termo.trim().toLowerCase();
        const tag = q.replace(/[^a-z0-9]/g, ''); // tags do dev.to são alfanuméricas

        const urlTag = `${API_BASE}?tag=${encodeURIComponent(tag)}&per_page=${PER_PAGE}`;
        const urlGeral = `${API_BASE}?per_page=${PER_PAGE}`;

        const [porTagRes, geraisRes] = await Promise.allSettled([
            tag ? requisicaoJson(urlTag) : Promise.resolve([]),
            requisicaoJson(urlGeral),
        ]);

        const porTag = porTagRes.status === 'fulfilled' ? porTagRes.value : [];
        const gerais = geraisRes.status === 'fulfilled' ? geraisRes.value : [];

        // Se ambas falharam, propaga o primeiro erro
        if (porTagRes.status === 'rejected' && geraisRes.status === 'rejected') {
            throw porTagRes.reason;
        }

        // Combina, deduplica por id e filtra pelo termo
        const mapa = new Map();
        [...porTag, ...gerais].forEach((a) => {
            if (a && a.id != null) mapa.set(String(a.id), a);
        });

        const todos = Array.from(mapa.values());
        const filtrados = todos.filter((a) => combina(a, q));

        // Se nada combinar (busca muito específica), retorna ao menos os
        // resultados da tag (que já são relevantes ao termo).
        return filtrados.length > 0 ? filtrados : porTag;
    }

    function combina(artigo, q) {
        const titulo = (artigo.title || '').toLowerCase();
        const desc = (artigo.description || '').toLowerCase();
        const tags = (artigo.tag_list || []).join(' ').toLowerCase();
        return titulo.includes(q) || desc.includes(q) || tags.includes(q);
    }

    // ════════════════ Validação ════════════════
    function validarBusca(valor) {
        const limpo = valor.trim();
        if (limpo.length === 0) {
            return { ok: false, msg: 'Digite um termo para buscar.' };
        }
        if (limpo.length < MIN_QUERY) {
            return { ok: false, msg: `A busca deve ter no mínimo ${MIN_QUERY} caracteres.` };
        }
        return { ok: true, valor: limpo };
    }

    function exibirErroValidacao(msg) {
        erroBusca.textContent = msg;
        inputBusca.classList.add('invalido');
        inputBusca.setAttribute('aria-invalid', 'true');
    }

    function limparErroValidacao() {
        erroBusca.textContent = '';
        inputBusca.classList.remove('invalido');
        inputBusca.removeAttribute('aria-invalid');
    }

    // ════════════════ Render ════════════════
    function escapar(str = '') {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatarData(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleDateString('pt-BR', {
                day: '2-digit', month: 'short', year: 'numeric',
            });
        } catch {
            return '';
        }
    }

    function templateArtigo(artigo) {
        const id = String(artigo.id);
        const ehFavorito = estado.favoritos.has(id);
        const capa = artigo.cover_image || artigo.social_image || '';
        const autor = artigo.user?.name || 'Autor desconhecido';
        const data = formatarData(artigo.published_at || artigo.created_at);
        const tags = (artigo.tag_list || []).slice(0, 4);

        const capaHtml = capa
            ? `<img class="artigo_capa" src="${escapar(capa)}" alt="" loading="lazy">`
            : `<div class="artigo_capa" aria-hidden="true"></div>`;

        const tagsHtml = tags.length
            ? `<div class="artigo_tags">${tags
                  .map((t) => `<span class="artigo_tag">#${escapar(t)}</span>`)
                  .join('')}</div>`
            : '';

        return `
            <li class="artigo" data-id="${escapar(id)}">
                ${capaHtml}
                <div class="artigo_corpo">
                    <h3 class="artigo_titulo">
                        <a href="${escapar(artigo.url)}" target="_blank" rel="noopener noreferrer">
                            ${escapar(artigo.title || 'Sem título')}
                        </a>
                    </h3>
                    <p class="artigo_meta">Por ${escapar(autor)} • ${escapar(data)}</p>
                    ${tagsHtml}
                    <div class="artigo_rodape">
                        <button class="botao_fav ${ehFavorito ? 'ativo' : ''}"
                                type="button"
                                data-acao="favoritar"
                                aria-pressed="${ehFavorito}">
                            ${ehFavorito ? '★ Favorito' : '☆ Favoritar'}
                        </button>
                        <a class="link_externo"
                           href="${escapar(artigo.url)}"
                           target="_blank" rel="noopener noreferrer">Ler artigo →</a>
                    </div>
                </div>
            </li>
        `;
    }

    function renderizarLista(container, artigos) {
        container.innerHTML = artigos.map(templateArtigo).join('');
        // Anexa handlers dos botões de favoritar
        $$('.botao_fav', container).forEach((btn) => {
            const li = btn.closest('.artigo');
            const id = li?.dataset.id;
            if (!id) return;
            btn.addEventListener('click', () => {
                // Procura o artigo (pode estar nos resultados em memória ou nos favoritos)
                const artigo = estado.favoritos.get(id) || resultadosCache.get(id);
                if (artigo) alternarFavorito(artigo);
            });
        });
    }

    function renderizarSkeletons(container, n = 6) {
        const card = `
            <li class="skel_card">
                <div class="skeleton skel_capa"></div>
                <div class="skeleton skel_linha"></div>
                <div class="skeleton skel_linha curta"></div>
            </li>`;
        container.innerHTML = card.repeat(n);
    }

    function renderizarFavoritos() {
        const arr = Array.from(estado.favoritos.values());
        if (arr.length === 0) {
            statusFavoritos.textContent = 'Você ainda não favoritou nenhum artigo.';
            statusFavoritos.classList.remove('erro');
            listaFavoritos.innerHTML = '';
            return;
        }
        statusFavoritos.textContent = `${arr.length} artigo(s) salvo(s) localmente neste navegador.`;
        statusFavoritos.classList.remove('erro');
        renderizarLista(listaFavoritos, arr);
    }

    function sincronizarBotoesFavoritos() {
        $$('#listaResultados .artigo').forEach((li) => {
            const id = li.dataset.id;
            const btn = $('.botao_fav', li);
            if (!btn) return;
            const ativo = estado.favoritos.has(id);
            btn.classList.toggle('ativo', ativo);
            btn.setAttribute('aria-pressed', String(ativo));
            btn.textContent = ativo ? '★ Favorito' : '☆ Favoritar';
        });
    }

    function atualizarContadores() {
        const n = estado.favoritos.size;
        contadorHeader.textContent = String(n);
        contadorAba.textContent = String(n);
    }

    // ════════════════ Cache em memória dos últimos resultados ════════════════
    const resultadosCache = new Map();

    // ════════════════ Fluxo principal ════════════════
    async function executarBusca(termo) {
        estado.ultimaBusca = termo;
        statusResultados.classList.remove('erro');
        statusResultados.textContent = `Buscando por "${termo}"...`;
        renderizarSkeletons(listaResultados, 6);

        try {
            const artigos = await buscarArtigos(termo);
            resultadosCache.clear();
            artigos.forEach((a) => resultadosCache.set(String(a.id), a));

            if (!artigos || artigos.length === 0) {
                listaResultados.innerHTML = '';
                statusResultados.textContent =
                    `Nenhum artigo encontrado para "${termo}". Tente outro termo.`;
                return;
            }

            statusResultados.textContent =
                `${artigos.length} artigo(s) encontrado(s) para "${termo}".`;
            renderizarLista(listaResultados, artigos);
        } catch (err) {
            console.error(err);
            listaResultados.innerHTML = '';
            statusResultados.classList.add('erro');
            statusResultados.textContent =
                err?.message || 'Não foi possível concluir a busca. Tente novamente em instantes.';
        }
    }

    // ════════════════ Navegação SPA por abas ════════════════
    function trocarAba(aba) {
        estado.aba = aba;
        $$('.aba').forEach((b) => {
            const ativo = b.dataset.aba === aba;
            b.classList.toggle('ativa', ativo);
            b.setAttribute('aria-selected', String(ativo));
        });
        painelResultados.classList.toggle('oculto', aba !== 'resultados');
        painelFavoritos.classList.toggle('oculto', aba !== 'favoritos');
        if (aba === 'favoritos') renderizarFavoritos();
    }

    function tratarRota() {
        const hash = (location.hash || '').replace('#', '');
        if (hash === 'favoritos') {
            trocarAba('favoritos');
            rolarAteApp();
        } else if (hash === 'artigos') {
            trocarAba('resultados');
            rolarAteApp();
        }
    }

    function rolarAteApp() {
        secaoApp.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ════════════════ Eventos ════════════════
    form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const { ok, msg, valor } = validarBusca(inputBusca.value);
        if (!ok) {
            exibirErroValidacao(msg);
            return;
        }
        limparErroValidacao();
        trocarAba('resultados');
        executarBusca(valor);
    });

    inputBusca.addEventListener('input', () => {
        if (inputBusca.classList.contains('invalido')) {
            const { ok } = validarBusca(inputBusca.value);
            if (ok) limparErroValidacao();
        }
    });

    $$('.aba').forEach((btn) => {
        btn.addEventListener('click', () => trocarAba(btn.dataset.aba));
    });

    $$('[data-route]').forEach((el) => {
        el.addEventListener('click', (ev) => {
            const rota = el.dataset.route;
            if (rota === 'home') {
                ev.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
            if (rota === 'artigos' || rota === 'favoritos') {
                ev.preventDefault();
                location.hash = rota;
                trocarAba(rota === 'favoritos' ? 'favoritos' : 'resultados');
                rolarAteApp();
            }
        });
    });

    window.addEventListener('hashchange', tratarRota);

    // ════════════════ Bootstrap ════════════════
    atualizarContadores();
    renderizarFavoritos();
    tratarRota();
})();

/* =========================================================================
 * ANIMAÇÃO DA LOGO VERDE (Mozilla) — Vanilla JS
 * -------------------------------------------------------------------------
 * Reproduz, de forma fiel, o comportamento da página inicial da Mozilla,
 * onde as partes da logo entram em cena, se montando até formar o
 * desenho final. Implementada com a Web Animations API (sem setInterval,
 * sem bibliotecas externas).
 *
 * Controles:
 *  - Botão ".botao_animacao":
 *      • clique  -> inicia a animação (texto vira "Pausar animação")
 *      • clique  -> pausa no quadro atual (texto vira "Continuar animação")
 *      • clique  -> retoma exatamente do ponto pausado
 *
 *  - Quando a animação termina um ciclo, ela faz loop suave.
 *
 * Observação: nada do restante do projeto foi alterado.
 * ========================================================================= */
(() => {
    'use strict';

    const svg = document.querySelector('.logo_verde');
    const botao = document.querySelector('.botao_animacao');
    if (!svg || !botao) return;

    const textoBotao = botao.querySelector('.botao_animacao_texto');

    // Partes da logo, na ordem do SVG:
    //  0 -> barra vertical esquerda
    //  1 -> quadrado pequeno
    //  2 -> retângulo conector (topo)
    //  3 -> barra horizontal superior
    //  4 -> polígono em zigue-zague
    const partes = Array.from(svg.children);

    // Reproduz a animação oficial da Mozilla: cada peça é "desenhada"
    // na direção natural do seu traço (wipe), usando scale a partir de
    // uma origem específica. Nada cai de fora da tela.
    //
    // eixo   -> 'x' | 'y'  (qual dimensão cresce)
    // origem -> ponto fixo da peça enquanto ela cresce
    const coreografia = [
        { eixo: 'y', origem: 'top center',    delay:   0, duracao: 650 }, // barra esquerda desce
        { eixo: 'xy', origem: 'center',       delay: 380, duracao: 380 }, // quadradinho aparece
        { eixo: 'y', origem: 'top center',    delay: 480, duracao: 320 }, // conector desce
        { eixo: 'x', origem: 'left center',   delay: 640, duracao: 520 }, // barra superior wipe →
        { eixo: 'x', origem: 'left center',   delay: 980, duracao: 780 }, // zigue-zague wipe →
    ];

    const EASING = 'cubic-bezier(.22,.61,.36,1)';
    const PAUSA_ENTRE_CICLOS = 700;

    // Garante que transform/origem fiquem em relação à própria peça do SVG.
    partes.forEach((el, i) => {
        el.style.transformBox = 'fill-box';
        el.style.transformOrigin = (coreografia[i] || coreografia[0]).origem;
        el.style.willChange = 'transform, opacity';
    });

    function escalaInicial(eixo) {
        if (eixo === 'x')  return 'scale(0, 1)';
        if (eixo === 'y')  return 'scale(1, 0)';
        return 'scale(0, 0)'; // 'xy'
    }

    /** @type {Animation[]} */
    let animacoes = [];
    let estado = 'parada'; // 'parada' | 'rodando' | 'pausada'
    let loopTimer = null;

    function montarAnimacoes() {
        cancelarAnimacoes();

        animacoes = partes.map((el, i) => {
            const { eixo, delay, duracao } = coreografia[i] || coreografia[0];
            const anim = el.animate(
                [
                    { transform: escalaInicial(eixo), opacity: 1 },
                    { transform: 'scale(1, 1)',      opacity: 1 },
                ],
                { duration: duracao, delay, easing: EASING, fill: 'both' }
            );
            anim.pause();
            return anim;
        });

        const ultima = animacoes[animacoes.length - 1];
        ultima.onfinish = () => {
            if (estado !== 'rodando') return;
            loopTimer = setTimeout(() => {
                if (estado !== 'rodando') return;
                animacoes.forEach((a) => { a.currentTime = 0; a.play(); });
            }, PAUSA_ENTRE_CICLOS);
        };
    }

    function cancelarAnimacoes() {
        clearTimeout(loopTimer);
        loopTimer = null;
        animacoes.forEach((a) => {
            a.onfinish = null;
            try { a.cancel(); } catch (_) { /* ignore */ }
        });
        animacoes = [];
    }

    function tocar() {
        if (animacoes.length === 0) montarAnimacoes();
        animacoes.forEach((a) => a.play());
        estado = 'rodando';
        atualizarBotao();
    }

    function pausar() {
        animacoes.forEach((a) => a.pause());
        clearTimeout(loopTimer);
        loopTimer = null;
        estado = 'pausada';
        atualizarBotao();
    }

    function atualizarBotao() {
        if (estado === 'rodando') {
            textoBotao.textContent = 'Pausar animação';
            botao.classList.add('is-playing');
            botao.setAttribute('aria-pressed', 'true');
        } else {
            textoBotao.textContent =
                estado === 'pausada' ? 'Continuar animação' : 'Reproduzir animação';
            botao.classList.remove('is-playing');
            botao.setAttribute('aria-pressed', 'false');
        }
    }

    botao.addEventListener('click', () => {
        if (estado === 'rodando') pausar();
        else tocar();
    });

    atualizarBotao();
})();