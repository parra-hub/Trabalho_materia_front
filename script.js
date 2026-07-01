
// PARTE 1: APLICATIVO DE BUSCA E FAVORITOS (DEV.TO)

(() => {
    // 'use strict' obriga o navegador a ser mais rigoroso. 
    // Ele avisa se você esquecer de declarar uma variável, evitando bugs silenciosos.
    'use strict';

    // 1. CONFIGURAÇÕES (As "regras" do nosso aplicativo)

    const API_BASE = 'https://dev.to/api/articles'; // Onde vamos buscar os artigos
    const STORAGE_KEY = 'mozilla_devto_favoritos_v1'; // Nome do arquivo invisível salvo no navegador
    const TIMEOUT_MS = 10000; // Tempo limite de 10 segundos para a internet responder
    const MIN_QUERY = 3; // O usuário precisa digitar pelo menos 3 letras para buscar
    const PER_PAGE = 24; // Quantos artigos vamos trazer de uma vez


    // 2. ATALHOS PARA O HTML (Facilitando a nossa vida)

    // Em vez de escrever document.querySelector toda hora, criamos a função $()
    const $ = (sel, root = document) => root.querySelector(sel);
    // O mesmo para pegar vários elementos, já convertendo a lista para uma Array real ( $$ )
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    // Aqui estamos "pescando" as partes do HTML pelo ID (#) e guardando na memória
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

    // 3. O "CÉREBRO" DO APP (Estado)

    // O 'estado' guarda como o aplicativo está naquele exato momento.
    const estado = {
        aba: 'resultados',     // Começamos vendo a aba de resultados
        ultimaBusca: '',       // Guarda a última palavra pesquisada
        favoritos: carregarFavoritos(), // Vai no navegador ver se já tem favoritos salvos
    };

    // Função que olha no disco rígido do navegador (localStorage) para buscar favoritos antigos
    function carregarFavoritos() {
        try {
            // Tenta pegar o texto bruto salvo
            const bruto = localStorage.getItem(STORAGE_KEY);
            if (!bruto) return new Map(); // Se não tiver nada, começa uma lista (Map) vazia
            
            // Converte o texto bruto em uma lista do JavaScript (Array)
            const arr = JSON.parse(bruto);
            if (!Array.isArray(arr)) return new Map();
            
            // Retorna um 'Map'. O Map é ótimo porque liga uma chave (o ID) ao valor (o Artigo),
            // facilitando muito achar ou apagar um artigo depois.
            return new Map(arr.map((a) => [String(a.id), a]));
        } catch (err) {
            // Se der erro (ex: o arquivo corrompeu), avisa no console e começa zerado
            console.warn('Falha ao ler favoritos do localStorage:', err);
            return new Map();
        }
    }

    // Função que pega os favoritos atuais e salva no navegador
    function salvarFavoritos() {
        try {
            const arr = Array.from(estado.favoritos.values()); // Transforma o Map em Array
            localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); // Transforma em texto e salva
        } catch (err) {
            console.warn('Falha ao salvar favoritos:', err);
        }
    }

    // Liga ou desliga a estrelinha de um artigo
    function alternarFavorito(artigo) {
        const id = String(artigo.id);
        
        if (estado.favoritos.has(id)) {
            // Se já tem na lista, nós apagamos (Desfavorita)
            estado.favoritos.delete(id);
        } else {
            // Se não tem, nós guardamos (Favorita)
            estado.favoritos.set(id, artigo);
        }
        
        // Sempre que mudar algo, temos que avisar o resto do app para se atualizar visualmente
        salvarFavoritos();
        atualizarContadores();
        sincronizarBotoesFavoritos();
        renderizarFavoritos();
    }


    // 4. COMUNICAÇÃO COM A INTERNET (Acessando a API do dev.to)

    // O 'async' significa que essa função vai demorar um tempo (depende da internet)
    async function requisicaoJson(url, { timeout = TIMEOUT_MS } = {}) {
        // O AbortController funciona como um "cronômetro de bomba". Se a internet
        // demorar mais que 10 segundos, ele "explode" e cancela a busca.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeout);
        
        try {
            // Vai na URL pedir os dados
            const resp = await fetch(url, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: ctrl.signal, // Conecta o cronômetro aqui
            });
            
            if (!resp.ok) {
                throw new Error(`Erro HTTP ${resp.status} ao consultar a API.`);
            }
            
            const dados = await resp.json(); // Traduz a resposta para JavaScript
            if (dados == null) throw new Error('Resposta vazia recebida da API.');
            return dados; // Entrega a lista de artigos
            
        } catch (err) {
            // Tratando erros pra mostrar mensagens amigáveis pro usuário
            if (err.name === 'AbortError') {
                throw new Error('Tempo esgotado ao consultar a API. Tente novamente.');
            }
            if (err instanceof TypeError) {
                throw new Error('Falha de conexão. Verifique sua internet.');
            }
            throw err;
        } finally {
            clearTimeout(timer); // A requisição acabou, desativa o cronômetro
        }
    }

    // Lógica inteligente para buscar os artigos
    async function buscarArtigos(termo) {
        const q = termo.trim().toLowerCase(); // Limpa espaços e deixa tudo minúsculo
        const tag = q.replace(/[^a-z0-9]/g, ''); // Tira acentos/símbolos pra buscar como #tag

        // Prepara dois caminhos diferentes de busca
        const urlTag = `${API_BASE}?tag=${encodeURIComponent(tag)}&per_page=${PER_PAGE}`;
        const urlGeral = `${API_BASE}?per_page=${PER_PAGE}`;

        // Dispara as duas buscas AO MESMO TEMPO (deixa o app mais rápido)
        const [porTagRes, geraisRes] = await Promise.allSettled([
            tag ? requisicaoJson(urlTag) : Promise.resolve([]),
            requisicaoJson(urlGeral),
        ]);

        // Pega os resultados de quem deu certo (fulfilled)
        const porTag = porTagRes.status === 'fulfilled' ? porTagRes.value : [];
        const gerais = geraisRes.status === 'fulfilled' ? geraisRes.value : [];

        // Se as duas falharem, joga o erro na tela
        if (porTagRes.status === 'rejected' && geraisRes.status === 'rejected') {
            throw porTagRes.reason;
        }

        // Junta tudo num Map pra garantir que não vamos ter artigos duplicados
        const mapa = new Map();
        [...porTag, ...gerais].forEach((a) => {
            if (a && a.id != null) mapa.set(String(a.id), a);
        });

        // Transforma o mapa de volta numa lista
        const todos = Array.from(mapa.values());
        
        // Passa um "pente fino" pra ter certeza de que a palavra pesquisada
        // realmente está no título, texto ou tag do artigo.
        const filtrados = todos.filter((a) => combina(a, q));
        
        return filtrados.length > 0 ? filtrados : porTag;
    }

    // Regra do "pente fino": checa se o texto pesquisado (q) está em algum lugar
    function combina(artigo, q) {
        const titulo = (artigo.title || '').toLowerCase();
        const desc = (artigo.description || '').toLowerCase();
        const tags = (artigo.tag_list || []).join(' ').toLowerCase();
        return titulo.includes(q) || desc.includes(q) || tags.includes(q);
    }


    // 5. FERRAMENTAS E VISUAL (Desenhando na tela)

    // Checa se o usuário não digitou bobeira no campo de busca
    function validarBusca(valor) {
        const limpo = valor.trim();
        if (limpo.length === 0) {
            return { ok: false, msg: 'Digite um termo para buscar.' };
        }
        if (limpo.length < MIN_QUERY) {
            return { ok: false, msg: `A busca deve ter no mínimo ${MIN_QUERY} caracteres.` };
        }
        return { ok: true, valor: limpo }; // Tudo certo!
    }

    // Pinta a caixa de texto de vermelho e mostra o erro
    function exibirErroValidacao(msg) {
        erroBusca.textContent = msg;
        inputBusca.classList.add('invalido');
        inputBusca.setAttribute('aria-invalid', 'true');
    }

    // Tira o vermelho e limpa o erro
    function limparErroValidacao() {
        erroBusca.textContent = '';
        inputBusca.classList.remove('invalido');
        inputBusca.removeAttribute('aria-invalid');
    }

    // PROTEÇÃO MEGA IMPORTANTE (Contra Hackers/XSS). 
    // Impede que código malicioso vindo da API vire código executável no nosso HTML.
    function escapar(str = '') {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Pega a data esquisita da internet (2024-05-10T12:00:00Z) e deixa bonita (10 de mai. de 2024)
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

    // A fábrica de cartões: Pega os dados brutos e monta a caixinha do artigo em HTML
    function templateArtigo(artigo) {
        const id = String(artigo.id);
        const ehFavorito = estado.favoritos.has(id); // Vê se já está nos favoritos para pintar a estrela
        const capa = artigo.cover_image || artigo.social_image || '';
        const autor = artigo.user?.name || 'Autor desconhecido';
        const data = formatarData(artigo.published_at || artigo.created_at);
        const tags = (artigo.tag_list || []).slice(0, 4); // Limita a 4 tags pra não quebrar o visual

        // Define se vai ter foto na capa ou só um espaço vazio
        const capaHtml = capa
            ? `<img class="artigo_capa" src="${escapar(capa)}" alt="" loading="lazy">`
            : `<div class="artigo_capa" aria-hidden="true"></div>`;

        // Monta as tags separadamente
        const tagsHtml = tags.length
            ? `<div class="artigo_tags">${tags
                  .map((t) => `<span class="artigo_tag">#${escapar(t)}</span>`)
                  .join('')}</div>`
            : '';

        // Devolve o HTML grandão
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

    // Pega todos os artigos gerados, joga na tela e "acorda" os botões de favorito
    function renderizarLista(container, artigos) {
        container.innerHTML = artigos.map(templateArtigo).join(''); // Joga no HTML
        
        // Procura todos os botões de favorito que acabaram de ser criados
        $$('.botao_fav', container).forEach((btn) => {
            const li = btn.closest('.artigo'); // Acha o pai dele
            const id = li?.dataset.id;
            if (!id) return;
            
            // Avisa o botão: "Quando clicarem em você, chame a função de favoritar!"
            btn.addEventListener('click', () => {
                const artigo = estado.favoritos.get(id) || resultadosCache.get(id);
                if (artigo) alternarFavorito(artigo);
            });
        });
    }

    // Cria blocos cinzas piscantes enquanto a internet está carregando os artigos
    function renderizarSkeletons(container, n = 6) {
        const card = `
            <li class="skel_card">
                <div class="skeleton skel_capa"></div>
                <div class="skeleton skel_linha"></div>
                <div class="skeleton skel_linha curta"></div>
            </li>`;
        container.innerHTML = card.repeat(n);
    }

    // Desenha a aba de Favoritos separadamente
    function renderizarFavoritos() {
        const arr = Array.from(estado.favoritos.values());
        
        // Se não tiver nenhum favorito, mostra uma mensagem de aviso
        if (arr.length === 0) {
            statusFavoritos.textContent = 'Você ainda não favoritou nenhum artigo.';
            statusFavoritos.classList.remove('erro');
            listaFavoritos.innerHTML = '';
            return;
        }
        
        // Se tiver, mostra a quantidade e renderiza a lista
        statusFavoritos.textContent = `${arr.length} artigo(s) salvo(s) localmente neste navegador.`;
        statusFavoritos.classList.remove('erro');
        renderizarLista(listaFavoritos, arr);
    }

    // Uma função muito esperta: se você estiver na aba de "Busca" e desfavoritar algo 
    // lá na aba de "Favoritos", ela apaga a estrelinha na aba de Busca pra não ficar confuso
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

    // Atualiza aquele numerozinho vermelho em cima das abas
    function atualizarContadores() {
        const n = estado.favoritos.size;
        contadorHeader.textContent = String(n);
        contadorAba.textContent = String(n);
    }

    // Guardamos a última busca aqui para o botão "Favoritar" lembrar quem era o artigo
    const resultadosCache = new Map();

    // 6. O CORAÇÃO DO PROGRAMA (Comandos principais)

    async function executarBusca(termo) {
        estado.ultimaBusca = termo;
        statusResultados.classList.remove('erro');
        statusResultados.textContent = `Buscando por "${termo}"...`;
        
        // Mostra a animação de carregamento (os blocos cinzas)
        renderizarSkeletons(listaResultados, 6);

        try {
            // Espera a API devolver os artigos
            const artigos = await buscarArtigos(termo);
            
            // Limpa a memória temporária e guarda os resultados novos nela
            resultadosCache.clear();
            artigos.forEach((a) => resultadosCache.set(String(a.id), a));

            // E se não acharmos nada?
            if (!artigos || artigos.length === 0) {
                listaResultados.innerHTML = '';
                statusResultados.textContent =
                    `Nenhum artigo encontrado para "${termo}". Tente outro termo.`;
                return;
            }

            // Sucesso! Mostra a quantidade e desenha a lista
            statusResultados.textContent =
                `${artigos.length} artigo(s) encontrado(s) para "${termo}".`;
            renderizarLista(listaResultados, artigos);
            
        } catch (err) {
            // Se der qualquer erro (falta de internet, api fora do ar, etc), avisamos aqui
            console.error(err);
            listaResultados.innerHTML = '';
            statusResultados.classList.add('erro');
            statusResultados.textContent =
                err?.message || 'Não foi possível concluir a busca. Tente novamente em instantes.';
        }
    }

    // Função que esconde uma aba e mostra a outra (Ex: Sai de Resultados, vai pra Favoritos)
    function trocarAba(aba) {
        estado.aba = aba; // Registra onde estamos
        
        // Pinta o botão da aba atual
        $$('.aba').forEach((b) => {
            const ativo = b.dataset.aba === aba;
            b.classList.toggle('ativa', ativo);
            b.setAttribute('aria-selected', String(ativo));
        });
        
        // Esconde/Mostra os painéis
        painelResultados.classList.toggle('oculto', aba !== 'resultados');
        painelFavoritos.classList.toggle('oculto', aba !== 'favoritos');
        
        // Toda vez que abrir a aba favoritos, desenha ela de novo pra garantir que tá atualizada
        if (aba === 'favoritos') renderizarFavoritos();
    }

    // Lê a URL do navegador (aquela parte com #) pra saber se o usuário digitou
    // o site direto na aba de favoritos (exemplo.com/#favoritos)
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

    // Desce a tela suavemente até a parte onde ficam os artigos
    function rolarAteApp() {
        secaoApp.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // 7. GATILHOS (Quando o usuário interage com a tela)

    
    // O que acontece quando aperta "Enter" ou clica na Lupa:
    form.addEventListener('submit', (ev) => {
        ev.preventDefault(); // Impede a página de recarregar do zero (comportamento padrão)
        
        const { ok, msg, valor } = validarBusca(inputBusca.value); // Checa se tá certo
        if (!ok) {
            exibirErroValidacao(msg); // Deu ruim, mostra erro
            return;
        }
        
        limparErroValidacao(); // Tudo certo! Limpa o erro
        trocarAba('resultados'); // Garante que estamos vendo a aba de busca
        executarBusca(valor); // Manda pesquisar!
    });

    // Esse evento apaga o texto vermelho de erro no momento em que você volta a digitar
    inputBusca.addEventListener('input', () => {
        if (inputBusca.classList.contains('invalido')) {
            const { ok } = validarBusca(inputBusca.value);
            if (ok) limparErroValidacao();
        }
    });

    // Avisa os botões de Aba para rodarem a função 'trocarAba' quando clicados
    $$('.aba').forEach((btn) => {
        btn.addEventListener('click', () => trocarAba(btn.dataset.aba));
    });

    // Controla os links do nosso Menu/Rodapé para eles navegarem pelas abas ao invés de recarregar a página
    $$('[data-route]').forEach((el) => {
        el.addEventListener('click', (ev) => {
            const rota = el.dataset.route;
            if (rota === 'home') {
                ev.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' }); // Sobe a página até o topo
                return;
            }
            if (rota === 'artigos' || rota === 'favoritos') {
                ev.preventDefault();
                location.hash = rota; // Muda a URL lá em cima
                trocarAba(rota === 'favoritos' ? 'favoritos' : 'resultados');
                rolarAteApp();
            }
        });
    });

    // Se o usuário clicar na setinha de "Voltar" do navegador, a gente capta isso
    window.addEventListener('hashchange', tratarRota);

    // 8. O START (A primeira coisa que roda quando a página abre)

    atualizarContadores(); // Atualiza os números
    renderizarFavoritos(); // Desenha a aba de favoritos oculta
    tratarRota(); // Verifica se a URL já mandava abrir direto num lugar específico

})();



// PARTE 2: ANIMAÇÃO DO LOGOTIPO (Aquela que dá play/pause)


(() => {
    'use strict';

    // 1. Buscamos o Logo e o Botão na tela
    const svg = document.querySelector('.logo_verde');
    const botao = document.querySelector('.botao_animacao');
    
    // Se por acaso eles não existirem (alguém apagou do HTML), o código para aqui e evita quebrar o site
    if (!svg || !botao) return;

    const textoBotao = botao.querySelector('.botao_animacao_texto');

    // Transforma os pedacinhos do desenho do Logo em uma Array para podermos animar um por um
    const partes = Array.from(svg.children);

    // 2. A Coreografia
    // Cada linha representa uma "parte" do logo e dita quanto tempo ela demora e qual lado ela cresce.
    // É isso que dá aquele efeito bonitão em sequência.
    const coreografia = [
        { eixo: 'y', origem: 'top center',    delay:   0, duracao: 650 }, 
        { eixo: 'xy', origem: 'center',       delay: 380, duracao: 380 }, 
        { eixo: 'y', origem: 'top center',    delay: 480, duracao: 320 }, 
        { eixo: 'x', origem: 'left center',   delay: 640, duracao: 520 }, 
        { eixo: 'x', origem: 'left center',   delay: 980, duracao: 780 }, 
    ];

    const EASING = 'cubic-bezier(.22,.61,.36,1)'; // A fórmula matemática da suavidade
    const PAUSA_ENTRE_CICLOS = 700; // Tempo parado antes de recomeçar a animação (em milissegundos)

    // Ajustamos o CSS de cada pedacinho do SVG pra ficarem prontos pra crescer
    partes.forEach((el, i) => {
        el.style.transformBox = 'fill-box';
        el.style.transformOrigin = (coreografia[i] || coreografia[0]).origem;
        el.style.willChange = 'transform, opacity'; // Dica de performance pro navegador
    });

    // Define qual vai ser o tamanho zero deles antes de crescer (horizontal, vertical ou ambos)
    function escalaInicial(eixo) {
        if (eixo === 'x')  return 'scale(0, 1)';
        if (eixo === 'y')  return 'scale(1, 0)';
        return 'scale(0, 0)'; 
    }

    // Variáveis de controle para sabermos o que a animação está fazendo
    let animacoes = [];
    let estado = 'parada'; 
    let loopTimer = null;

    // 3. Montando as regras da Animação
    function montarAnimacoes() {
        cancelarAnimacoes(); // Limpa a lousa

        // Pega cada parte do desenho e cria sua animação usando código (Web Animations API)
        animacoes = partes.map((el, i) => {
            const { eixo, delay, duracao } = coreografia[i] || coreografia[0];
            
            // O comando `.animate` é como criar um CSS @keyframes dinamicamente
            const anim = el.animate(
                [
                    { transform: escalaInicial(eixo), opacity: 1 }, // Estágio 1: Encolhido
                    { transform: 'scale(1, 1)',       opacity: 1 }, // Estágio 2: Tamanho normal
                ],
                { duration: duracao, delay, easing: EASING, fill: 'both' }
            );
            
            anim.pause(); // Nasce pausado
            return anim;
        });

        // Configurando o loop (repetição infinita)
        const ultima = animacoes[animacoes.length - 1]; // Olha pra última parte a se mover
        ultima.onfinish = () => {
            // Se alguém apertou pause no meio do caminho, não recomeça
            if (estado !== 'rodando') return; 
            
            // Dá a pausa de 700ms e manda tudo rodar de novo
            loopTimer = setTimeout(() => {
                if (estado !== 'rodando') return;
                animacoes.forEach((a) => { a.currentTime = 0; a.play(); });
            }, PAUSA_ENTRE_CICLOS);
        };
    }

    // Função "Destruidora": Mata todas as animações
    function cancelarAnimacoes() {
        clearTimeout(loopTimer);
        loopTimer = null;
        animacoes.forEach((a) => {
            a.onfinish = null;
            try { a.cancel(); } catch (_) { /* ignore */ }
        });
        animacoes = [];
    }

    // Manda bala na animação
    function tocar() {
        if (animacoes.length === 0) montarAnimacoes(); // Cria se não existirem
        animacoes.forEach((a) => a.play()); // Toca a música maestro
        estado = 'rodando';
        atualizarBotao(); // Avisa o botão pra mudar o texto pra "Pausar"
    }

    // Congela a animação na hora
    function pausar() {
        animacoes.forEach((a) => a.pause());
        clearTimeout(loopTimer); // Cancela o recomeço agendado
        loopTimer = null;
        estado = 'pausada';
        atualizarBotao(); // Avisa o botão pra mudar o texto pra "Continuar"
    }

    // Função que só cuida de pintar o botão e mudar o que tá escrito dentro dele
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

    // Gatilho do Botão: Se tá tocando, pausa. Se não tá, toca!
    botao.addEventListener('click', () => {
        if (estado === 'rodando') pausar();
        else tocar();
    });

    // Seta a aparência inicial do botão pra combinar com tudo desligado
    atualizarBotao();
})();
