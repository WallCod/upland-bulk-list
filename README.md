<p align="center">
  <img src="https://img.shields.io/badge/userscript-Violentmonkey%20%7C%20Tampermonkey-orange?style=flat-square" alt="userscript badge" />
  <img src="https://img.shields.io/badge/game-Upland-blueviolet?style=flat-square" alt="upland badge" />
  <img src="https://img.shields.io/github/license/WallCod/upland-bulk-list?style=flat-square" alt="license badge" />
  <img src="https://img.shields.io/badge/version-1.4.1-brightgreen?style=flat-square" alt="version badge" />
</p>

<p align="center">
  🇧🇷 Português (este arquivo) · <a href="./README.en.md">🇺🇸 English</a>
</p>

# 🛠️ Upland Tools

Userscript com ferramentas pra Showroom do Upland. Hoje traz **📦 Bulk List**: lista várias unidades do mesmo item pelo mesmo preço, automatizando o clique repetitivo de "select → preço → confirmar → fechar" para cada unidade. Também tem **🐛 Report Issue**, pra reportar um problema direto do jogo sem precisar de conta no GitHub.

Feito para quem usa a ferramenta de mover vários itens da fábrica pra Showroom e depois precisa listar um por um manualmente — esse script cuida da parte de listar.

⭐ Se o script te ajudou, considera dar uma estrela no repositório.

## 📥 Instalação

**Instalação rápida (se você já tem Violentmonkey ou Tampermonkey instalado):**

[📥 Clique aqui pra instalar direto](https://raw.githubusercontent.com/WallCod/upland-bulk-list/master/bulk-list-items.user.js)

O gerenciador vai detectar o link automaticamente e abrir a tela de instalação.

**Passo a passo completo (se ainda não tem um gerenciador de userscripts):**

1. Instale um gerenciador de userscripts: [Violentmonkey](https://violentmonkey.github.io/) (recomendado) ou [Tampermonkey](https://www.tampermonkey.net/).
2. Clique no [link de instalação rápida](https://raw.githubusercontent.com/WallCod/upland-bulk-list/master/bulk-list-items.user.js) acima — o gerenciador abre a tela de instalação sozinho.
3. Confira se o script está **ativo especificamente para `play.upland.me`** — alguns gerenciadores (Violentmonkey incluso) têm um toggle por-site separado do toggle geral do script, guardado no popup da extensão quando você está na aba do jogo. Se o botão não aparecer depois de instalar, é o motivo mais provável.
4. O script se atualiza sozinho depois disso (auto-update via `@downloadURL`). Se quiser forçar uma checagem manual, use o botão de refresh do script no Dashboard do gerenciador.

## ⚠️ Pré-requisitos (importante ler antes de usar)

- **🌐 Idioma do jogo em inglês.** O script procura textos exatos como `"List for sale"`, `"List my ..."`, `"Search"`. Se o Upland estiver em outro idioma para sua conta, o script não vai encontrar os botões e vai falhar.
- **💰 Escolha a moeda no formulário.** O script suporta listar em UPX ou USD — selecione a opção certa no formulário antes de rodar, e ele troca o "OFFER TYPE" automaticamente na tela do jogo.
- **🏬 Funciona em qualquer Showroom com o mesmo layout.** Testado em map assets, structure ornaments e outras categorias que seguem o mesmo fluxo de "select → preço → confirmar".
- **🔗 Você entende que isso lista itens de verdade, na loja de verdade.** Não é uma simulação. Cada unidade listada gera uma transação real e irreversível pelo script (dá pra remover a listagem manualmente depois, como qualquer outra).

## ▶️ Como usar

1. Vá até a Showroom no jogo, na tela inicial (antes de clicar em "List my..." — o script cuida disso).
2. Clique no botão **"Upland Tools"** no canto inferior direito e escolha **"Bulk List"** no menu.
3. Preencha o formulário: nome exato do item (como aparece na lista, ex: `BLUE TARGET MARKER`), moeda (UPX ou USD), preço por unidade, e quantidade a listar.
4. O script verifica se o item existe na sua Showroom antes de começar, e mostra uma tela de confirmação com o total esperado (e um aviso se a quantidade disponível parecer menor que a pedida).
5. Confirme, e o script roda sozinho, listando uma unidade por vez, com uma pausa entre cada uma para dar tempo da transação confirmar on-chain.
6. Ao final, um resumo mostra quantas unidades foram listadas com sucesso e quantas foram puladas.

## 🔁 Como ele lida com problemas no meio da rodada

- **Erro do servidor numa unidade (HTTP 4xx/5xx):** tenta de novo até 3 vezes, com espera crescente (8s, 16s, 24s, 32s) — instabilidade momentânea do servidor do Upland é comum e costuma se resolver sozinha depois de alguns minutos.
- **Se a mesma unidade continuar falhando** depois de todas as tentativas: o script marca aquela unidade específica (pelo MINT# dela) e pula para a próxima, em vez de travar a rodada inteira ou ficar preso repetindo a mesma unidade problemática.
- **Se o script perder o rastro da interface** (um botão esperado não aparece — sinal de que o layout do jogo mudou ou algo inesperado aconteceu): a rodada para por completo e o log mostra exatamente onde.

## 🐛 Reportando um problema

Se algo der errado, não precisa abrir issue no GitHub nem ter conta. Clique em **"Upland Tools" → "Report Issue"**, descreva o que aconteceu e envie. O log recente da sessão vai anexado automaticamente, então o report já chega com contexto técnico suficiente pra investigar.

Se preferir, também dá pra [abrir uma issue no GitHub](https://github.com/WallCod/upland-bulk-list/issues) diretamente.

## 📌 Limitações conhecidas

- **Depende de textos e seletores fixos da UI do Upland.** Se o jogo atualizar o layout da tela de Showroom/listagem, o script pode parar de funcionar até ser atualizado.
- **Não decide preço nem quantidade por você.** Confira sempre a tela de confirmação antes de aceitar.
- **A verificação de "quantas unidades existem" é aproximada.** A lista de itens é virtualizada (só renderiza o que está perto da área visível), então o número mostrado na confirmação pode ser menor que a quantidade real disponível.
- **Testado principalmente com uma conta, idioma inglês e uma resolução de tela.** Se encontrar um comportamento diferente no seu setup, use o Report Issue ou abra uma issue.

## 🆘 Se algo travar

O script mostra um log detalhado na caixinha ao lado do botão, e também no Console do navegador (F12). Se parar no meio, o log mostra exatamente em qual etapa e por quê (`item-not-found`, `price-input-not-found`, `submit-rejected`, etc). Confira quantos itens já foram listados de fato na aba "FOR SALE" antes de rodar de novo, para não duplicar.

## ⚖️ Aviso

Este projeto não é afiliado ao Upland Interactive. Use por sua conta e risco — teste com quantidades pequenas antes de rodar em lotes grandes. Nenhuma credencial ou token de conta é usado ou armazenado pelo script: ele só interage com a página que já está aberta e logada no seu navegador.

## 📄 Licença

MIT — veja [LICENSE](./LICENSE).

## 👤 Autor

Feito por **[WallCod](https://github.com/WallCod)**.
